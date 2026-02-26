/**
 * logger.test.js — Tests for logging, history, safe serialization, and Supabase reporting.
 *
 * Focuses on the bugs we fixed:
 *   1. Circular reference handling in sendErrorReport
 *   2. Error object serialization (non-enumerable props)
 *   3. HTTP 429 errors (no errors[] array) captured properly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLogger } from '../logger.js';

describe('Logger', () => {
  let logger;

  beforeEach(() => {
    logger = createLogger({ level: 'silent' }); // don't spam console
  });

  // ── History ────────────────────────────────────────────────────────────

  describe('history', () => {
    it('stores entries in history regardless of log level', () => {
      logger.debug('debug msg');
      logger.info('info msg');
      logger.error('error msg');
      expect(logger.getHistory()).toHaveLength(3);
    });

    it('getErrorHistory returns only error/warn entries', () => {
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn', { code: 'W1' });
      logger.error('error', { code: 'E1' });
      const errors = logger.getErrorHistory();
      expect(errors).toHaveLength(2);
      expect(errors[0].level).toBe('warn');
      expect(errors[1].level).toBe('error');
    });

    it('limits history to maxHistory', () => {
      const small = createLogger({ level: 'silent', maxHistory: 3 });
      small.info('1'); small.info('2'); small.info('3'); small.info('4');
      const hist = small.getHistory();
      expect(hist).toHaveLength(3);
      expect(hist[0].message).toBe('2'); // oldest was evicted
    });

    it('clearHistory empties the buffer', () => {
      logger.error('err'); logger.warn('warn');
      logger.clearHistory();
      expect(logger.getHistory()).toHaveLength(0);
    });
  });

  // ── apiError ───────────────────────────────────────────────────────────

  describe('apiError', () => {
    it('captures GraphQL errors with extracted + raw fields', () => {
      const error = {
        message: 'Bad column value',
        response: {
          errors: [{
            message: 'Bad column value',
            extensions: { code: 'ColumnValueException', status_code: 200 },
            path: ['create_item'],
          }],
          extensions: { request_id: 'req-abc' },
        },
      };
      logger.apiError('createItem', error);

      const entry = logger.getErrorHistory(1)[0];
      expect(entry.data.operation).toBe('createItem');
      expect(entry.data.requestId).toBe('req-abc');
      expect(entry.data.errors[0].code).toBe('ColumnValueException');
      // rawResponse should contain the full response
      expect(entry.data.rawResponse).toBeDefined();
    });

    it('captures HTTP 429 errors (top-level error_code, no errors[])', () => {
      const error = {
        message: 'COMPLEXITY_BUDGET_EXHAUSTED',
        response: {
          error_code: 'COMPLEXITY_BUDGET_EXHAUSTED',
          error_message: 'Complexity budget exhausted',
          extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED', retry_in_seconds: 15 },
        },
      };
      logger.apiError('getItems', error);

      const entry = logger.getErrorHistory(1)[0];
      expect(entry.data.errors).toHaveLength(1);
      expect(entry.data.errors[0].code).toBe('COMPLEXITY_BUDGET_EXHAUSTED');
      expect(entry.data.errors[0].message).toBe('Complexity budget exhausted');
    });

    it('captures network errors (Error object, no response)', () => {
      const error = new Error('fetch failed');
      logger.apiError('getItems', error);

      const entry = logger.getErrorHistory(1)[0];
      expect(entry.data.message).toBe('fetch failed');
      expect(entry.data.rawResponse).toBeDefined();
      // Should capture Error non-enumerable props via safeSerialize
      expect(entry.data.rawResponse.message).toBe('fetch failed');
      expect(entry.data.rawResponse.name).toBe('Error');
    });
  });

  // ── Safe Serialization ─────────────────────────────────────────────────

  describe('safe serialization', () => {
    it('handles circular references without crashing', () => {
      const error = {
        message: 'test',
        response: { errors: [{ message: 'test', extensions: { code: 'TestError' } }] },
      };
      error.response.self = error.response; // circular

      expect(() => logger.apiError('test', error)).not.toThrow();
      const entry = logger.getErrorHistory(1)[0];
      expect(entry.data.errors[0].code).toBe('TestError');
    });

    it('serializes Error objects with message and stack', () => {
      const err = new Error('something broke');
      err.customProp = 42;
      logger.apiError('test', err);

      const entry = logger.getErrorHistory(1)[0];
      expect(entry.data.rawResponse.message).toBe('something broke');
      expect(entry.data.rawResponse.name).toBe('Error');
    });

    it('deep-clones error response (snapshot, not reference)', () => {
      const error = {
        message: 'Bad value',
        response: {
          errors: [{
            message: 'Bad value',
            extensions: { code: 'ColumnValueException', error_data: { column_type: 'status' } },
          }],
          extensions: { request_id: 'req-deep' },
        },
      };
      logger.apiError('test', error);

      // Mutate the original error object after capture
      error.response.errors[0].extensions.code = 'MUTATED';
      error.response.extensions.request_id = 'MUTATED';

      // The captured rawResponse should be a snapshot, unaffected by mutation
      const entry = logger.getErrorHistory(1)[0];
      expect(entry.data.rawResponse.errors[0].extensions.code).toBe('ColumnValueException');
      expect(entry.data.rawResponse.extensions.request_id).toBe('req-deep');
      // Deep nested data should also be cloned
      expect(entry.data.rawResponse.errors[0].extensions.error_data.column_type).toBe('status');
    });

    it('deep-clones nested arrays in error response', () => {
      const error = {
        message: 'Multiple errors',
        response: {
          errors: [
            { message: 'err1', extensions: { code: 'A' } },
            { message: 'err2', extensions: { code: 'B' } },
          ],
        },
      };
      logger.apiError('test', error);

      // Mutate original
      error.response.errors.push({ message: 'err3' });

      const entry = logger.getErrorHistory(1)[0];
      // rawResponse should have exactly 2 errors (snapshot before push)
      expect(entry.data.rawResponse.errors).toHaveLength(2);
    });
  });

  // ── sendErrorReport (Supabase) ─────────────────────────────────────────

  describe('sendErrorReport', () => {
    it('returns { success: false } when Supabase not configured', async () => {
      logger.error('test error');
      const result = await logger.sendErrorReport();
      expect(result.success).toBe(false);
    });

    it('returns { success: true, count: 0 } when no errors in history', async () => {
      logger.initSupabase('https://test.supabase.co', 'test-key');
      logger.info('not an error');
      const result = await logger.sendErrorReport();
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it('sends rows to Supabase with correct structure', async () => {
      let capturedBody;
      const mockFetch = vi.fn(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'test-key');
      logger.setContext({ userId: 'u1', accountId: 'a1', boardId: 'b1' });

      // Simulate a real error flowing through apiError
      const error = {
        message: 'Bad value',
        response: {
          errors: [{
            message: 'Bad value',
            extensions: { code: 'ColumnValueException', status_code: 200, request_id: 'req-xyz' },
            path: ['create_item'],
          }],
        },
      };
      logger.apiError('createItem', error);

      const result = await logger.sendErrorReport({ userNote: 'It broke' });

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(mockFetch).toHaveBeenCalledOnce();

      // Check Supabase row structure
      const row = capturedBody[0];
      expect(row.level).toBe('error');
      expect(row.error_code).toBe('ColumnValueException');
      expect(row.operation).toBe('createItem');
      expect(row.user_id).toBe('u1');
      expect(row.board_id).toBe('b1');
      expect(row.user_note).toBe('It broke');
      expect(row.report_id).toBeDefined();

      // data field should be valid JSON (not crash on stringify)
      expect(() => JSON.parse(row.data)).not.toThrow();
      const parsed = JSON.parse(row.data);
      expect(parsed.rawResponse).toBeDefined();

      vi.unstubAllGlobals();
    });

    it('does not crash when raw error has circular references', async () => {
      const mockFetch = vi.fn(async () => ({ ok: true }));
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'test-key');

      const error = {
        message: 'circular',
        response: {
          errors: [{ message: 'err', extensions: { code: 'TestError' } }],
        },
      };
      error.response.self = error.response; // circular
      logger.apiError('test', error);

      const result = await logger.sendErrorReport();
      expect(result.success).toBe(true);

      // The data field should still be valid JSON
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(() => JSON.parse(body[0].data)).not.toThrow();

      vi.unstubAllGlobals();
    });

    it('sends correct headers to Supabase', async () => {
      let capturedHeaders;
      const mockFetch = vi.fn(async (url, opts) => {
        capturedHeaders = opts.headers;
        return { ok: true };
      });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'my-anon-key');
      logger.error('test');
      await logger.sendErrorReport();

      expect(capturedHeaders['apikey']).toBe('my-anon-key');
      expect(capturedHeaders['Authorization']).toBe('Bearer my-anon-key');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['Prefer']).toBe('return=minimal');

      vi.unstubAllGlobals();
    });

    it('posts to correct Supabase URL', async () => {
      let capturedUrl;
      const mockFetch = vi.fn(async (url) => { capturedUrl = url; return { ok: true }; });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co/', 'key'); // trailing slash
      logger.error('test');
      await logger.sendErrorReport();

      expect(capturedUrl).toBe('https://test.supabase.co/rest/v1/error_logs');

      vi.unstubAllGlobals();
    });

    it('uses custom table name', async () => {
      let capturedUrl;
      const mockFetch = vi.fn(async (url) => { capturedUrl = url; return { ok: true }; });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'key', { table: 'my_errors' });
      logger.error('test');
      await logger.sendErrorReport();

      expect(capturedUrl).toContain('/rest/v1/my_errors');

      vi.unstubAllGlobals();
    });

    it('includes fingerprint and report_type in rows', async () => {
      let capturedBody;
      const mockFetch = vi.fn(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'test-key');
      logger.error('test error');

      await logger.sendErrorReport({ fingerprint: 'fp-abc123' });

      const row = capturedBody[0];
      expect(row.fingerprint).toBe('fp-abc123');
      expect(row.report_type).toBe('user');

      vi.unstubAllGlobals();
    });

    it('includes breadcrumbs in report data', async () => {
      let capturedBody;
      const mockFetch = vi.fn(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'test-key');
      logger.addBreadcrumb('api', '→ getItems', { variables: {} });
      logger.addBreadcrumb('api', '← getItems (50ms)', { durationMs: 50 });
      logger.error('test error');

      await logger.sendErrorReport();

      const row = capturedBody[0];
      expect(row.breadcrumbs).toBeDefined();
      const crumbs = JSON.parse(row.breadcrumbs);
      expect(crumbs).toHaveLength(2);
      expect(crumbs[0].category).toBe('api');

      vi.unstubAllGlobals();
    });
  });

  // ── Breadcrumbs ──────────────────────────────────────────────────────────

  describe('breadcrumbs', () => {
    it('stores breadcrumbs via addBreadcrumb', () => {
      logger.addBreadcrumb('ui', 'Clicked save', { itemId: '123' });
      logger.addBreadcrumb('navigation', 'Switched tab');

      const crumbs = logger.getBreadcrumbs();
      expect(crumbs).toHaveLength(2);
      expect(crumbs[0].category).toBe('ui');
      expect(crumbs[0].message).toBe('Clicked save');
      expect(crumbs[0].data).toEqual({ itemId: '123' });
      expect(crumbs[1].category).toBe('navigation');
    });

    it('respects maxBreadcrumbs limit', () => {
      const small = createLogger({ level: 'silent', maxBreadcrumbs: 3 });
      small.addBreadcrumb('a', 'one');
      small.addBreadcrumb('b', 'two');
      small.addBreadcrumb('c', 'three');
      small.addBreadcrumb('d', 'four');

      const crumbs = small.getBreadcrumbs();
      expect(crumbs).toHaveLength(3);
      expect(crumbs[0].message).toBe('two'); // oldest evicted
      expect(crumbs[2].message).toBe('four');
    });

    it('getBreadcrumbs returns a copy (not a reference)', () => {
      logger.addBreadcrumb('test', 'item');
      const crumbs1 = logger.getBreadcrumbs();
      const crumbs2 = logger.getBreadcrumbs();
      expect(crumbs1).not.toBe(crumbs2);
      expect(crumbs1).toEqual(crumbs2);
    });

    it('clearBreadcrumbs empties the buffer', () => {
      logger.addBreadcrumb('test', 'item');
      logger.clearBreadcrumbs();
      expect(logger.getBreadcrumbs()).toHaveLength(0);
    });

    it('auto-captures breadcrumbs on apiRequest', () => {
      logger.apiRequest('getItems', { boardId: '123' });
      const crumbs = logger.getBreadcrumbs();
      expect(crumbs).toHaveLength(1);
      expect(crumbs[0].category).toBe('api');
      expect(crumbs[0].message).toContain('getItems');
    });

    it('auto-captures breadcrumbs on apiResponse', () => {
      logger.apiResponse('getItems', { data: {} }, 150);
      const crumbs = logger.getBreadcrumbs();
      expect(crumbs).toHaveLength(1);
      expect(crumbs[0].category).toBe('api');
      expect(crumbs[0].message).toContain('150ms');
      expect(crumbs[0].data.durationMs).toBe(150);
    });

    it('auto-captures breadcrumbs on apiError', () => {
      const error = {
        message: 'Bad value',
        response: {
          errors: [{
            message: 'Bad value',
            extensions: { code: 'ColumnValueException' },
          }],
        },
      };
      logger.apiError('createItem', error);
      const crumbs = logger.getBreadcrumbs();
      expect(crumbs).toHaveLength(1);
      expect(crumbs[0].category).toBe('api.error');
      expect(crumbs[0].message).toContain('createItem');
      expect(crumbs[0].level).toBe('error');
    });

    it('getAnonymizedBreadcrumbs filters to API-only and strips variables', () => {
      logger.addBreadcrumb('ui', 'Clicked button', { userId: 'u1' });
      logger.addBreadcrumb('api', '→ getItems', { variables: { boardId: '123' } });
      logger.addBreadcrumb('api', '← getItems (50ms)', { durationMs: 50, hasErrors: false });
      logger.addBreadcrumb('api.error', '✖ createItem', { code: 'ColumnValueException' });
      logger.addBreadcrumb('navigation', 'Switched tab');

      const anon = logger.getAnonymizedBreadcrumbs();
      // Only api/api.error breadcrumbs (not ui or navigation)
      expect(anon).toHaveLength(3);
      // No variables in data
      expect(anon[0].data).toEqual({ durationMs: undefined, hasErrors: undefined, code: undefined });
      expect(anon[1].data).toEqual({ durationMs: 50, hasErrors: false, code: undefined });
      expect(anon[2].data).toEqual({ durationMs: undefined, hasErrors: undefined, code: 'ColumnValueException' });
    });
  });

  // ── sendAnonymousEvent ──────────────────────────────────────────────────

  describe('sendAnonymousEvent', () => {
    it('returns { success: false } when Supabase not configured', async () => {
      const result = await logger.sendAnonymousEvent({ fingerprint: 'fp-123' });
      expect(result.success).toBe(false);
    });

    it('sends to RPC endpoint with correct structure', async () => {
      let capturedUrl, capturedBody;
      const mockFetch = vi.fn(async (url, opts) => {
        capturedUrl = url;
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'test-key');
      logger.setContext({ appVersion: '1.2.3', environment: 'production' });

      const result = await logger.sendAnonymousEvent({
        fingerprint: 'fp-abc',
        error_code: 'ColumnValueException',
        operation: 'createItem',
      });

      expect(result.success).toBe(true);
      // Uses RPC function, not direct table REST
      expect(capturedUrl).toBe('https://test.supabase.co/rest/v1/rpc/insert_error_event');

      const payload = capturedBody.payload;
      expect(payload.fingerprint).toBe('fp-abc');
      expect(payload.error_code).toBe('ColumnValueException');
      expect(payload.operation).toBe('createItem');
      expect(payload.app_version).toBe('1.2.3');
      expect(payload.environment).toBe('production');
      expect(payload.breadcrumbs).toBeDefined();

      // Verify NO PII fields
      expect(payload.user_id).toBeUndefined();
      expect(payload.account_id).toBeUndefined();
      expect(payload.board_id).toBeUndefined();

      vi.unstubAllGlobals();
    });

    it('includes anonymized breadcrumbs (API only, no variables)', async () => {
      let capturedBody;
      const mockFetch = vi.fn(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true };
      });
      vi.stubGlobal('fetch', mockFetch);

      logger.initSupabase('https://test.supabase.co', 'test-key');

      // Add various breadcrumbs
      logger.addBreadcrumb('ui', 'Clicked button', { userId: 'secret' });
      logger.addBreadcrumb('api', '→ getItems', { variables: { boardId: '123' } });
      logger.addBreadcrumb('api.error', '✖ createItem', { code: 'ERR' });

      await logger.sendAnonymousEvent({ fingerprint: 'fp-test' });

      const crumbs = capturedBody.payload.breadcrumbs;
      // Only api/api.error (not ui)
      expect(crumbs).toHaveLength(2);
      // No variables in the data
      expect(crumbs[0].data.variables).toBeUndefined();

      vi.unstubAllGlobals();
    });
  });
});
