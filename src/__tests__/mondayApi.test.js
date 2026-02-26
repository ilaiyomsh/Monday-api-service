/**
 * mondayApi.test.js — Tests for MondayApiService
 *
 * Mocks monday-sdk-js to test the full flow:
 *   - init() sets up SDK, fetches context
 *   - query() calls monday.api(), unwraps data, handles errors
 *   - CRUD methods build correct queries and variables
 *   - getUsers/getTeams/getUsersAndTeams
 *   - loadItemsByIds batching and concurrency
 *   - Error handling integration with errorHandler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock monday-sdk-js ────────────────────────────────────────────────────

const mockMonday = {
  setApiVersion: vi.fn(),
  api: vi.fn(),
  get: vi.fn(),
  execute: vi.fn(),
  listen: vi.fn(),
  storage: {
    instance: {
      getItem: vi.fn(),
      setItem: vi.fn(),
    },
  },
};

vi.mock('monday-sdk-js', () => ({
  default: () => mockMonday,
}));

// Import after mock
const { createMondayApiService } = await import('../mondayApi.js');

// ── Helpers ───────────────────────────────────────────────────────────────

/** Create a fresh, initialized service instance */
async function createInitializedService(options = {}) {
  const service = createMondayApiService();
  mockMonday.get.mockResolvedValueOnce({
    data: {
      boardId: '123',
      user: { id: 'u1' },
      account: { id: 'a1' },
      instanceId: 'inst1',
      app: { id: 'app1' },
      theme: 'light',
    },
  });
  await service.init({ logLevel: 'silent', ...options });
  return service;
}

/** Simulate a successful monday.api() response */
function mockApiSuccess(data) {
  mockMonday.api.mockResolvedValueOnce({ data, errors: undefined, extensions: {} });
}

/** Simulate monday.api() returning errors in the response (Shape A) */
function mockApiWithErrors(errors, data = null) {
  mockMonday.api.mockResolvedValueOnce({ data, errors, extensions: { request_id: 'req-123' } });
}

/** Simulate monday.api() throwing a plain Error (Shape B — SDK throws) */
function mockApiThrow(message = 'Graphql validation errors', data = undefined) {
  const err = new Error(message);
  if (data) err.data = data;
  mockMonday.api.mockRejectedValueOnce(err);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('MondayApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub performance.now for timing
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  // ── Init ──────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('initializes the SDK and returns context', async () => {
      const service = await createInitializedService();
      expect(mockMonday.setApiVersion).toHaveBeenCalledWith('2026-01');
      expect(service.boardId).toBe('123');
      expect(service.user).toEqual({ id: 'u1' });
      expect(service.theme).toBe('light');
    });

    it('uses custom apiVersion when provided', async () => {
      const service = await createInitializedService({ apiVersion: '2025-10' });
      expect(mockMonday.setApiVersion).toHaveBeenCalledWith('2025-10');
      expect(service.apiVersion).toBe('2025-10');
    });

    it('handles context fetch failure gracefully', async () => {
      const service = createMondayApiService();
      mockMonday.get.mockRejectedValueOnce(new Error('no context'));
      await service.init({ logLevel: 'silent' });
      expect(service.context).toEqual({});
    });
  });

  // ── Assertion ─────────────────────────────────────────────────────────

  describe('pre-init assertion', () => {
    it('throws if query() called before init()', async () => {
      const service = createMondayApiService();
      await expect(service.query('{ me { id } }')).rejects.toThrow('Call mondayApi.init() first.');
    });
  });

  // ── query() ───────────────────────────────────────────────────────────

  describe('query()', () => {
    it('returns unwrapped data on success', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ boards: [{ id: '123' }] });

      const result = await service.query('query { boards { id } }');
      expect(result).toEqual({ boards: [{ id: '123' }] });
    });

    it('throws normalized error when response has errors', async () => {
      const service = await createInitializedService();
      mockMonday.api.mockResolvedValueOnce({
        data: null,
        errors: [{ message: 'Bad column value', extensions: { code: 'ColumnValueException' } }],
        extensions: { request_id: 'req-999' },
      });

      await expect(
        service.query('mutation { ... }', {}, { retry: false })
      ).rejects.toThrow('Bad column value');
    });

    it('throws when SDK throws a plain Error', async () => {
      const service = await createInitializedService();
      mockApiThrow('Graphql validation errors');

      await expect(
        service.query('invalid query', {}, { retry: false })
      ).rejects.toThrow('Graphql validation errors');
    });

    it('passes variables to monday.api()', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ items: [] });

      await service.query('query ($ids: [ID!]) { boards(ids: $ids) { id } }', { ids: ['1'] }, { retry: false });
      expect(mockMonday.api).toHaveBeenCalledWith(
        expect.any(String),
        { variables: { ids: ['1'] } }
      );
    });
  });

  // ── Error normalization ───────────────────────────────────────────────

  describe('error normalization via #execute', () => {
    it('normalized error has response.errors for error handler', async () => {
      const service = await createInitializedService();
      mockMonday.api.mockResolvedValueOnce({
        data: null,
        errors: [{
          message: 'User unauthorized',
          extensions: { code: 'USER_UNAUTHORIZED', status_code: 403 },
        }],
        extensions: { request_id: 'req-auth' },
      });

      try {
        await service.query('query { me { id } }', {}, { retry: false });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).toBe('User unauthorized');
        expect(err.response.errors[0].extensions.code).toBe('USER_UNAUTHORIZED');
      }
    });
  });

  // ── CRUD Methods ──────────────────────────────────────────────────────

  describe('CRUD methods', () => {
    it('getItems() returns items and cursor', async () => {
      const service = await createInitializedService();
      mockApiSuccess({
        boards: [{
          items_page: {
            cursor: 'next-cursor',
            items: [{ id: '1', name: 'Item 1' }],
          },
        }],
      });

      const result = await service.getItems('123', { limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.cursor).toBe('next-cursor');
    });

    it('getItems() with cursor uses next_items_page', async () => {
      const service = await createInitializedService();
      mockApiSuccess({
        next_items_page: {
          cursor: null,
          items: [{ id: '2', name: 'Item 2' }],
        },
      });

      const result = await service.getItems('123', { cursor: 'some-cursor' });
      expect(result.items).toHaveLength(1);
      expect(result.cursor).toBeNull();
      // Verify the query uses cursor variable
      expect(mockMonday.api).toHaveBeenCalledWith(
        expect.stringContaining('next_items_page'),
        expect.any(Object)
      );
    });

    it('createItem() sends correct variables', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ create_item: { id: '99', name: 'New' } });

      const result = await service.createItem('123', 'New', { status: { label: 'Done' } }, { groupId: 'topics' });
      expect(result).toEqual({ id: '99', name: 'New' });
      const call = mockMonday.api.mock.calls[0];
      const vars = call[1].variables;
      expect(vars.boardId).toBe('123');
      expect(vars.itemName).toBe('New');
      expect(JSON.parse(vars.columnValues)).toEqual({ status: { label: 'Done' } });
      expect(vars.groupId).toBe('topics');
    });

    it('deleteItem() sends correct itemId', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ delete_item: { id: '42' } });

      const result = await service.deleteItem(42);
      expect(result).toEqual({ id: '42' });
      const vars = mockMonday.api.mock.calls[0][1].variables;
      expect(vars.itemId).toBe('42');
    });

    it('getBoard() returns board or null', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ boards: [{ id: '123', name: 'My Board' }] });

      const board = await service.getBoard('123');
      expect(board).toEqual({ id: '123', name: 'My Board' });
    });
  });

  // ── getUsers / getTeams / getUsersAndTeams ────────────────────────────

  describe('getUsers()', () => {
    it('returns users array', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ users: [{ id: '1', name: 'Alice', photo_tiny: 'url' }] });

      const users = await service.getUsers();
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Alice');
    });

    it('returns empty array when no users', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ users: null });

      const users = await service.getUsers();
      expect(users).toEqual([]);
    });
  });

  describe('getTeams()', () => {
    it('returns teams array', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ teams: [{ id: '10', name: 'Dev', picture_url: 'url', users: [{ id: '1' }] }] });

      const teams = await service.getTeams();
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe('Dev');
    });
  });

  describe('getUsersAndTeams()', () => {
    it('returns both users and teams', async () => {
      const service = await createInitializedService();
      // getUsers query
      mockApiSuccess({ users: [{ id: '1', name: 'Alice', photo_tiny: 'url' }] });
      // getTeams query
      mockApiSuccess({ teams: [{ id: '10', name: 'Dev', picture_url: 'url', users: [] }] });

      const { users, teams } = await service.getUsersAndTeams();
      expect(users).toHaveLength(1);
      expect(teams).toHaveLength(1);
    });

    it('returns users when teams query fails (missing scope)', async () => {
      const service = await createInitializedService();
      // getUsers succeeds
      mockApiSuccess({ users: [{ id: '1', name: 'Alice', photo_tiny: 'url' }] });
      // getTeams fails
      mockApiThrow('Not authorized');

      const { users, teams } = await service.getUsersAndTeams();
      expect(users).toHaveLength(1);
      expect(teams).toEqual([]);
    });

    it('returns teams when users query fails', async () => {
      const service = await createInitializedService();
      // getUsers fails
      mockApiThrow('Not authorized');
      // getTeams succeeds
      mockApiSuccess({ teams: [{ id: '10', name: 'Dev', picture_url: 'url', users: [] }] });

      const { users, teams } = await service.getUsersAndTeams();
      expect(users).toEqual([]);
      expect(teams).toHaveLength(1);
    });
  });

  // ── loadItemsByIds ────────────────────────────────────────────────────

  describe('loadItemsByIds()', () => {
    it('returns empty array for empty input', async () => {
      const service = await createInitializedService();
      const items = await service.loadItemsByIds([]);
      expect(items).toEqual([]);
      expect(mockMonday.api).not.toHaveBeenCalled();
    });

    it('loads items in a single batch', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ items: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] });

      const items = await service.loadItemsByIds(['1', '2']);
      expect(items).toHaveLength(2);
    });

    it('splits into correct number of batches', async () => {
      const service = await createInitializedService();
      const ids = Array.from({ length: 250 }, (_, i) => String(i + 1));

      // 3 batches: 100 + 100 + 50
      mockApiSuccess({ items: Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1) })) });
      mockApiSuccess({ items: Array.from({ length: 100 }, (_, i) => ({ id: String(i + 101) })) });
      mockApiSuccess({ items: Array.from({ length: 50 }, (_, i) => ({ id: String(i + 201) })) });

      const items = await service.loadItemsByIds(ids, { batchSize: 100, maxConcurrent: 3 });
      expect(items).toHaveLength(250);
      expect(mockMonday.api).toHaveBeenCalledTimes(3);
    });

    it('respects maxConcurrent — runs batches in groups', async () => {
      const service = await createInitializedService();
      const ids = Array.from({ length: 500 }, (_, i) => String(i + 1));
      const callOrder = [];

      // 5 batches, maxConcurrent = 2 → group1(2), group2(2), group3(1)
      mockMonday.api.mockImplementation(async () => {
        callOrder.push(Date.now());
        return { data: { items: [{ id: '1' }] }, errors: undefined, extensions: {} };
      });

      await service.loadItemsByIds(ids, { batchSize: 100, maxConcurrent: 2 });
      expect(mockMonday.api).toHaveBeenCalledTimes(5);
    });

    it('handles failed batches without blocking others', async () => {
      const service = await createInitializedService();
      const ids = Array.from({ length: 200 }, (_, i) => String(i + 1));

      // First batch succeeds
      mockApiSuccess({ items: [{ id: '1', name: 'A' }] });
      // Second batch fails
      mockApiThrow('API error');

      const items = await service.loadItemsByIds(ids, { batchSize: 100, maxConcurrent: 3 });
      // Only items from successful batch
      expect(items).toHaveLength(1);
    });

    it('converts numeric IDs to strings', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ items: [{ id: '42', name: 'Test' }] });

      await service.loadItemsByIds([42, 99]);
      const vars = mockMonday.api.mock.calls[0][1].variables;
      expect(vars.itemIds).toEqual(['42', '99']);
    });
  });

  // ── Retry Integration ─────────────────────────────────────────────────

  describe('retry integration', () => {
    it('retries on rate limit errors and eventually succeeds', async () => {
      const service = await createInitializedService();

      // First call: rate limit error in response
      mockMonday.api.mockResolvedValueOnce({
        data: null,
        errors: [{ message: 'Budget exhausted', extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED', retry_in_seconds: 0.01 } }],
        extensions: {},
      });
      // Second call: success
      mockApiSuccess({ boards: [{ id: '123' }] });

      const result = await service.query('query { boards { id } }', {}, { operation: 'test' });
      expect(result).toEqual({ boards: [{ id: '123' }] });
      expect(mockMonday.api).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-retryable errors', async () => {
      const service = await createInitializedService();

      mockMonday.api.mockResolvedValueOnce({
        data: null,
        errors: [{ message: 'Bad value', extensions: { code: 'ColumnValueException' } }],
        extensions: {},
      });

      await expect(
        service.query('mutation { ... }', {}, { operation: 'test' })
      ).rejects.toThrow('Bad value');
      expect(mockMonday.api).toHaveBeenCalledTimes(1);
    });

    it('skips retry when retry=false', async () => {
      const service = await createInitializedService();

      mockMonday.api.mockResolvedValueOnce({
        data: null,
        errors: [{ message: 'Budget exhausted', extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED' } }],
        extensions: {},
      });

      await expect(
        service.query('query { ... }', {}, { retry: false })
      ).rejects.toThrow();
      expect(mockMonday.api).toHaveBeenCalledTimes(1);
    });
  });

  // ── UI Helpers ────────────────────────────────────────────────────────

  describe('UI helpers', () => {
    it('notice() calls monday.execute with correct args', async () => {
      const service = await createInitializedService();
      mockMonday.execute.mockResolvedValueOnce();

      await service.notice('Hello', 'success', 3000);
      expect(mockMonday.execute).toHaveBeenCalledWith('notice', { message: 'Hello', type: 'success', timeout: 3000 });
    });

    it('confirm() returns true on confirm', async () => {
      const service = await createInitializedService();
      mockMonday.execute.mockResolvedValueOnce({ data: { confirm: true } });

      const result = await service.confirm('Are you sure?');
      expect(result).toBe(true);
    });

    it('confirm() returns false on error', async () => {
      const service = await createInitializedService();
      mockMonday.execute.mockRejectedValueOnce(new Error('fail'));

      const result = await service.confirm('Are you sure?');
      expect(result).toBe(false);
    });
  });

  // ── Storage ───────────────────────────────────────────────────────────

  describe('storage', () => {
    it('storageGet() parses JSON value', async () => {
      const service = await createInitializedService();
      mockMonday.storage.instance.getItem.mockResolvedValueOnce({
        data: { value: JSON.stringify({ foo: 'bar' }) },
      });

      const result = await service.storageGet('myKey');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('storageGet() returns null for missing key', async () => {
      const service = await createInitializedService();
      mockMonday.storage.instance.getItem.mockResolvedValueOnce({ data: { value: null } });

      const result = await service.storageGet('missing');
      expect(result).toBeNull();
    });

    it('storageSet() stringifies value', async () => {
      const service = await createInitializedService();
      mockMonday.storage.instance.setItem.mockResolvedValueOnce();

      await service.storageSet('myKey', { foo: 'bar' });
      expect(mockMonday.storage.instance.setItem).toHaveBeenCalledWith('myKey', '{"foo":"bar"}');
    });
  });

  // ── Subitem ───────────────────────────────────────────────────────────

  describe('createSubitem()', () => {
    it('sends correct mutation', async () => {
      const service = await createInitializedService();
      mockApiSuccess({ create_subitem: { id: '55', name: 'Sub', board: { id: '999' } } });

      const result = await service.createSubitem('100', 'Sub', { status: { label: 'New' } });
      expect(result).toEqual({ id: '55', name: 'Sub', board: { id: '999' } });
      const vars = mockMonday.api.mock.calls[0][1].variables;
      expect(vars.parentItemId).toBe('100');
    });
  });

  // ── Init Options (appVersion, environment, autoReport) ────────────────

  describe('init options', () => {
    it('passes appVersion and environment to logger context', async () => {
      const { logger } = await import('../logger.js');
      const spy = vi.spyOn(logger, 'setContext');

      await createInitializedService({
        appVersion: '2.0.0',
        environment: 'staging',
      });

      // setContext should have been called with the new fields
      const contextCall = spy.mock.calls[0][0];
      expect(contextCall.appVersion).toBe('2.0.0');
      expect(contextCall.environment).toBe('staging');
      expect(contextCall.sessionId).toBeDefined();
      expect(contextCall.sessionId).toMatch(/^\d+-[a-z0-9]+$/);

      spy.mockRestore();
    });

    it('enables auto-report by default when Supabase is configured', async () => {
      const { errorHandler } = await import('../errorHandler.js');
      const spy = vi.spyOn(errorHandler, 'setAutoReport');

      await createInitializedService({
        supabase: { url: 'https://test.supabase.co', anonKey: 'key' },
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );

      spy.mockRestore();
    });

    it('respects autoReport.enabled=false override', async () => {
      const { errorHandler } = await import('../errorHandler.js');
      const spy = vi.spyOn(errorHandler, 'setAutoReport');

      await createInitializedService({
        supabase: { url: 'https://test.supabase.co', anonKey: 'key' },
        autoReport: { enabled: false },
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false })
      );

      spy.mockRestore();
    });
  });
});
