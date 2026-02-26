/**
 * mondayApi.js — Unified Monday.com API Service (Client-Side Only)
 *
 * Uses monday-sdk-js exclusively:
 *   - monday.api()   → GraphQL queries/mutations (no token needed inside iframe)
 *   - monday.get()   → context, settings
 *   - monday.execute()  → UI actions (notice, confirm)
 *   - monday.listen()   → event listeners
 *   - monday.storage    → app-level storage
 *
 * Error handling flow:
 *   1. Auto-retry on rate limits (transparent to user)
 *   2. If still fails → error bubbles up to your component
 *   3. Your component uses <ErrorBanner> for the nice UX
 *   4. User clicks "Send problem details" → sends to Supabase
 *
 * Requires: npm i monday-sdk-js
 */

import mondaySdk from 'monday-sdk-js';
import { logger } from './logger.js';
import { errorHandler } from './errorHandler.js';

const DEFAULT_API_VERSION = '2026-01';
const DEFAULT_PAGE_LIMIT = 50;

class MondayApiService {
  /** @type {ReturnType<typeof mondaySdk> | null} */
  #monday;
  /** @type {string} */
  #apiVersion;
  /** @type {object | null} */
  #context;
  /** @type {boolean} */
  #initialized;

  constructor() {
    this.#monday = null;
    this.#apiVersion = DEFAULT_API_VERSION;
    this.#context = null;
    this.#initialized = false;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  /**
   * Initialize the Monday API service.
   *
   * @param {object} [options]
   * @param {'he'|'en'} [options.language='he'] — Language for error messages
   * @param {string} [options.logLevel='info'] — Log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
   * @param {string} [options.apiVersion='2026-01'] — Monday.com API version
   * @param {string} [options.appVersion] — App version string (e.g. '1.2.3') for error tracking
   * @param {'development'|'staging'|'production'} [options.environment='production'] — Environment for error tracking
   * @param {{ url: string, anonKey: string, table?: string }} [options.supabase] — Supabase config for error reporting
   * @param {{ enabled?: boolean, maxPerSession?: number }} [options.autoReport] — Auto-report config
   * @returns {Promise<object>} — The monday.com context object
   */
  async init(options = {}) {
    const {
      language = 'he',
      logLevel = 'info',
      apiVersion = DEFAULT_API_VERSION,
      appVersion,
      environment = 'production',
      supabase,
      autoReport,
    } = options;

    this.#monday = mondaySdk();
    this.#apiVersion = apiVersion;
    this.#monday.setApiVersion(this.#apiVersion);

    logger.setLevel(logLevel);
    errorHandler.setMondayInstance(this.#monday);
    errorHandler.setLanguage(language);

    try {
      const res = await this.#monday.get('context');
      this.#context = res.data;
    } catch (e) {
      this.#context = {};
    }

    // Generate session ID for correlating errors within a session
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userAgent = typeof navigator !== 'undefined'
      ? (navigator.userAgent || '').slice(0, 200) : '';

    logger.setContext({
      userId:      this.#context.user?.id,
      accountId:   this.#context.account?.id,
      boardId:     this.#context.boardId,
      instanceId:  this.#context.instanceId,
      appId:       this.#context.app?.id,
      theme:       this.#context.theme,
      appVersion:  appVersion || null,
      environment,
      sessionId,
      userAgent,
    });

    // Auto-detect Supabase config: explicit > env vars
    const supabaseUrl = supabase?.url
      || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL)
      || null;
    const supabaseKey = supabase?.anonKey
      || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY)
      || null;

    if (supabaseUrl && supabaseKey) {
      logger.initSupabase(supabaseUrl, supabaseKey, {
        table: supabase?.table,
      });

      // Enable auto-report by default when Supabase is configured
      const autoReportConfig = {
        enabled: autoReport?.enabled !== undefined ? autoReport.enabled : true,
        maxPerSession: autoReport?.maxPerSession || 10,
      };
      errorHandler.setAutoReport(autoReportConfig);
    } else if (autoReport) {
      errorHandler.setAutoReport(autoReport);
    }

    logger.info('Monday API Service initialized', {
      boardId: this.#context.boardId, apiVersion: this.#apiVersion, language,
      appVersion, environment,
    });

    this.#initialized = true;
    return this.#context;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  /** @returns {ReturnType<typeof mondaySdk>} The underlying monday SDK instance. */
  get monday()     { this.#assert(); return this.#monday; }

  /** @returns {object | null} The full monday.com context object. */
  get context()    { return this.#context; }

  /** @returns {string | undefined} The current board ID. */
  get boardId()    { return this.#context?.boardId; }

  /** @returns {object | undefined} The current user object. */
  get user()       { return this.#context?.user; }

  /** @returns {string | undefined} The current theme ('light' | 'dark'). */
  get theme()      { return this.#context?.theme; }

  /** @returns {string} The API version in use. */
  get apiVersion() { return this.#apiVersion; }

  // ── Raw GraphQL ───────────────────────────────────────────────────────────

  /**
   * Execute a raw GraphQL query/mutation with auto-retry.
   *
   * @param {string} query — GraphQL query or mutation string
   * @param {object} [variables={}] — GraphQL variables
   * @param {object} [options]
   * @param {string} [options.operation='graphql'] — Operation name for logging/error tracking
   * @param {boolean} [options.retry=true] — Whether to auto-retry on retryable errors
   * @returns {Promise<object>} — The `data` field from the GraphQL response
   */
  async query(query, variables = {}, options = {}) {
    this.#assert();
    const { operation = 'graphql', retry = true } = options;

    const execute = async () => {
      const start = performance.now();
      logger.apiRequest(operation, variables);
      const data = await this.#execute(query, variables);
      logger.apiResponse(operation, { data }, Math.round(performance.now() - start));
      return data;
    };

    return retry ? errorHandler.withRetry(execute, { operation }) : execute();
  }

  // ── Items CRUD ────────────────────────────────────────────────────────────

  /**
   * Get a page of items from a board.
   *
   * @param {string|number} boardId — Board ID
   * @param {object} [options]
   * @param {number} [options.limit=50] — Items per page (max 500)
   * @param {string} [options.cursor] — Cursor for next page
   * @param {string[]} [options.columnIds] — Specific column IDs to return
   * @returns {Promise<{ items: object[], cursor: string | null }>}
   */
  async getItems(boardId, options = {}) {
    const { limit = DEFAULT_PAGE_LIMIT, cursor, columnIds } = options;
    const colFilter = columnIds ? `, column_ids: ${JSON.stringify(columnIds)}` : '';

    if (cursor) {
      const data = await this.query(`
        query ($cursor: String!) {
          next_items_page(cursor: $cursor, limit: ${limit}) {
            cursor
            items { id name group { id title } column_values${colFilter} { id text value type column { title } } created_at updated_at }
          }
        }`, { cursor }, { operation: 'getItems:page' });
      return { items: data.next_items_page?.items || [], cursor: data.next_items_page?.cursor || null };
    }

    const data = await this.query(`
      query ($ids: [ID!]) {
        boards(ids: $ids) {
          items_page(limit: ${limit}) {
            cursor
            items { id name group { id title } column_values${colFilter} { id text value type column { title } } created_at updated_at }
          }
        }
      }`, { ids: [String(boardId)] }, { operation: 'getItems' });
    const page = data.boards?.[0]?.items_page;
    return { items: page?.items || [], cursor: page?.cursor || null };
  }

  /**
   * Get all items from a board (auto-paginates).
   *
   * @param {string|number} boardId — Board ID
   * @param {object} [options]
   * @param {number} [options.limit=50] — Items per page
   * @param {number} [options.maxItems=500] — Maximum total items to fetch
   * @param {string[]} [options.columnIds] — Specific column IDs to return
   * @returns {Promise<object[]>} — Array of all items
   */
  async getAllItems(boardId, options = {}) {
    const { limit = DEFAULT_PAGE_LIMIT, maxItems = 500, columnIds } = options;
    const all = [];
    let cursor = null;
    do {
      const result = await this.getItems(boardId, { limit, cursor, columnIds });
      all.push(...result.items);
      cursor = result.cursor;
      if (all.length >= maxItems) break;
    } while (cursor);
    return all;
  }

  /**
   * Create an item on a board.
   *
   * @param {string|number} boardId — Board ID
   * @param {string} itemName — Item name
   * @param {object} [columnValues={}] — Column values (will be JSON.stringified)
   * @param {object} [options]
   * @param {string} [options.groupId] — Target group ID
   * @param {boolean} [options.createLabelsIfMissing=false] — Auto-create missing status/dropdown labels
   * @returns {Promise<{ id: string, name: string }>}
   */
  async createItem(boardId, itemName, columnValues = {}, options = {}) {
    const { groupId, createLabelsIfMissing = false } = options;
    const vars = { boardId: String(boardId), itemName, columnValues: JSON.stringify(columnValues) };
    if (groupId) vars.groupId = groupId;
    const data = await this.query(`
      mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON${groupId ? ', $groupId: String!' : ''}) {
        create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues${groupId ? ', group_id: $groupId' : ''}${createLabelsIfMissing ? ', create_labels_if_missing: true' : ''}) { id name }
      }`, vars, { operation: 'createItem' });
    return data.create_item;
  }

  /**
   * Update a single column value (JSON format).
   *
   * @param {string|number} boardId — Board ID
   * @param {string|number} itemId — Item ID
   * @param {string} columnId — Column ID
   * @param {object} value — Column value (will be JSON.stringified)
   * @returns {Promise<{ id: string }>}
   */
  async updateColumnValue(boardId, itemId, columnId, value) {
    const data = await this.query(`
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }`, { boardId: String(boardId), itemId: String(itemId), columnId, value: JSON.stringify(value) },
      { operation: 'updateColumnValue' });
    return data.change_column_value;
  }

  /**
   * Update a single column value (simple string format).
   *
   * @param {string|number} boardId — Board ID
   * @param {string|number} itemId — Item ID
   * @param {string} columnId — Column ID
   * @param {string} value — Plain string value
   * @returns {Promise<{ id: string }>}
   */
  async updateSimpleColumnValue(boardId, itemId, columnId, value) {
    const data = await this.query(`
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
        change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }`, { boardId: String(boardId), itemId: String(itemId), columnId, value: String(value) },
      { operation: 'updateSimpleColumnValue' });
    return data.change_simple_column_value;
  }

  /**
   * Update multiple column values at once.
   *
   * @param {string|number} boardId — Board ID
   * @param {string|number} itemId — Item ID
   * @param {object} columnValues — Column values map (will be JSON.stringified)
   * @param {object} [options]
   * @param {boolean} [options.createLabelsIfMissing=false] — Auto-create missing labels
   * @returns {Promise<{ id: string }>}
   */
  async updateMultipleColumnValues(boardId, itemId, columnValues, options = {}) {
    const { createLabelsIfMissing = false } = options;
    const data = await this.query(`
      mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues${createLabelsIfMissing ? ', create_labels_if_missing: true' : ''}) { id }
      }`, { boardId: String(boardId), itemId: String(itemId), columnValues: JSON.stringify(columnValues) },
      { operation: 'updateMultipleColumnValues' });
    return data.change_multiple_column_values;
  }

  /**
   * Delete an item.
   *
   * @param {string|number} itemId — Item ID
   * @returns {Promise<{ id: string }>}
   */
  async deleteItem(itemId) {
    const data = await this.query(`
      mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }
    `, { itemId: String(itemId) }, { operation: 'deleteItem' });
    return data.delete_item;
  }

  // ── Board ─────────────────────────────────────────────────────────────────

  /**
   * Get board metadata (columns, groups, owners).
   *
   * @param {string|number} boardId — Board ID
   * @returns {Promise<object | null>}
   */
  async getBoard(boardId) {
    const data = await this.query(`
      query ($ids: [ID!]) {
        boards(ids: $ids) { id name description state permissions columns { id title type settings_str } groups { id title color position } owners { id name } }
      }`, { ids: [String(boardId)] }, { operation: 'getBoard' });
    return data.boards?.[0] || null;
  }

  // ── Users & Teams ───────────────────────────────────────────────────────

  /**
   * Get account users.
   *
   * @param {object} [options]
   * @param {number} [options.limit=50] — Max users to return
   * @returns {Promise<Array<{ id: string, name: string, photo_tiny: string }>>}
   */
  async getUsers(options = {}) {
    const { limit = 50 } = options;
    const data = await this.query(`
      query { users(limit: ${limit}) { id name photo_tiny } }
    `, {}, { operation: 'getUsers' });
    return data.users || [];
  }

  /**
   * Get account teams. Requires `teams:read` scope.
   *
   * @returns {Promise<Array<{ id: string, name: string, picture_url: string, users: Array<{ id: string }> }>>}
   */
  async getTeams() {
    const data = await this.query(`
      query { teams { id name picture_url users { id } } }
    `, {}, { operation: 'getTeams' });
    return data.teams || [];
  }

  /**
   * Get both users and teams in parallel.
   * Teams query failure (e.g. missing `teams:read` scope) does not block users.
   *
   * @param {object} [options]
   * @param {number} [options.userLimit=50] — Max users to return
   * @returns {Promise<{ users: object[], teams: object[] }>}
   */
  async getUsersAndTeams(options = {}) {
    const { userLimit = 50 } = options;
    let users = [];
    let teams = [];

    const usersPromise = this.getUsers({ limit: userLimit })
      .then(result => { users = result; })
      .catch(err => {
        logger.error('getUsersAndTeams: users query failed', { error: err?.message });
      });

    const teamsPromise = this.getTeams()
      .then(result => { teams = result; })
      .catch(err => {
        logger.error('getUsersAndTeams: teams query failed (teams:read scope may not be granted)', { error: err?.message });
      });

    await Promise.all([usersPromise, teamsPromise]);
    return { users, teams };
  }

  // ── Batch Item Loading ─────────────────────────────────────────────────

  /**
   * Load items by IDs in batches with concurrency control.
   *
   * Splits the IDs into batches (default 100) and runs them with limited
   * concurrency (default 3). Failed batches return empty arrays without
   * blocking other batches.
   *
   * @param {Array<string|number>} itemIds — Item IDs to load
   * @param {object} [options]
   * @param {number} [options.batchSize=100] — IDs per batch (max 100 for items query)
   * @param {number} [options.maxConcurrent=3] — Max concurrent API calls
   * @param {string[]} [options.columnIds] — Specific column IDs to return
   * @returns {Promise<object[]>} — Flat array of all loaded items
   */
  async loadItemsByIds(itemIds, options = {}) {
    this.#assert();
    const { batchSize = 100, maxConcurrent = 3, columnIds } = options;

    if (!itemIds || itemIds.length === 0) return [];

    const columnIdsArg = columnIds ? `, ids: ${JSON.stringify(columnIds)}` : '';
    const query = `
      query ($itemIds: [ID!]!) {
        items(ids: $itemIds, limit: ${batchSize}) {
          id name
          column_values${columnIdsArg} {
            id text value type
            column { id title type }
          }
        }
      }`;

    // Split into batches
    const batches = [];
    for (let i = 0; i < itemIds.length; i += batchSize) {
      batches.push(itemIds.slice(i, i + batchSize).map(String));
    }

    logger.info(`loadItemsByIds: ${itemIds.length} IDs → ${batches.length} batches (max ${maxConcurrent} concurrent)`);

    const fetchBatch = async (batch, batchIndex) => {
      try {
        const data = await this.query(query, { itemIds: batch }, {
          operation: `loadItemsByIds:batch${batchIndex + 1}`,
        });
        return data.items || [];
      } catch (err) {
        logger.error(`loadItemsByIds: batch ${batchIndex + 1}/${batches.length} failed`, { error: err?.message });
        return [];
      }
    };

    // Run batches with concurrency control
    const allItems = [];
    for (let i = 0; i < batches.length; i += maxConcurrent) {
      const concurrentBatches = batches.slice(i, i + maxConcurrent);
      const results = await Promise.all(
        concurrentBatches.map((batch, idx) => fetchBatch(batch, i + idx))
      );
      allItems.push(...results.flat());
    }

    logger.info(`loadItemsByIds: loaded ${allItems.length} items total`);
    return allItems;
  }

  // ── Subitems ──────────────────────────────────────────────────────────────

  /**
   * Create a subitem under a parent item.
   *
   * @param {string|number} parentItemId — Parent item ID
   * @param {string} itemName — Subitem name
   * @param {object} [columnValues={}] — Column values (will be JSON.stringified)
   * @returns {Promise<{ id: string, name: string, board: { id: string } }>}
   */
  async createSubitem(parentItemId, itemName, columnValues = {}) {
    const data = await this.query(`
      mutation ($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
        create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) { id name board { id } }
      }`, { parentItemId: String(parentItemId), itemName, columnValues: JSON.stringify(columnValues) },
      { operation: 'createSubitem' });
    return data.create_subitem;
  }

  // ── UI Helpers ────────────────────────────────────────────────────────────

  /**
   * Show a monday.com notification.
   *
   * @param {string} message — Notification text
   * @param {'info'|'success'|'error'} [type='info'] — Notification type
   * @param {number} [timeout=5000] — Auto-dismiss after ms
   */
  async notice(message, type = 'info', timeout = 5000) {
    this.#assert();
    try { await this.#monday.execute('notice', { message, type, timeout }); } catch (e) { /* */ }
  }

  /**
   * Show a confirmation dialog.
   *
   * @param {string} message — Confirmation text
   * @param {string} [confirmButton='אישור'] — Confirm button text
   * @param {string} [cancelButton='ביטול'] — Cancel button text
   * @returns {Promise<boolean>} — true if user confirmed
   */
  async confirm(message, confirmButton = 'אישור', cancelButton = 'ביטול') {
    this.#assert();
    try {
      const res = await this.#monday.execute('confirm', { message, confirmButton, cancelButton });
      return res?.data?.confirm || false;
    } catch (e) { return false; }
  }

  /**
   * Listen for settings changes.
   * @param {(settings: object) => void} cb — Callback receiving new settings
   * @returns {Function} Unsubscribe function
   */
  onSettingsChange(cb) { this.#assert(); return this.#monday.listen('settings', r => cb(r.data)); }

  /**
   * Listen for context changes.
   * @param {(context: object) => void} cb — Callback receiving new context
   * @returns {Function} Unsubscribe function
   */
  onContextChange(cb)  { this.#assert(); return this.#monday.listen('context', r => { this.#context = r.data; cb(r.data); }); }

  /**
   * Get current app settings.
   * @returns {Promise<object>}
   */
  async getSettings()  { this.#assert(); return (await this.#monday.get('settings')).data; }

  // ── Storage ───────────────────────────────────────────────────────────────

  /**
   * Get a value from app instance storage.
   *
   * @param {string} key — Storage key
   * @returns {Promise<any | null>} — Parsed JSON value, or null if not found
   */
  async storageGet(key) {
    this.#assert();
    const res = await this.#monday.storage.instance.getItem(key);
    return res?.data?.value ? JSON.parse(res.data.value) : null;
  }

  /**
   * Set a value in app instance storage.
   *
   * @param {string} key — Storage key
   * @param {any} value — Value to store (will be JSON.stringified)
   */
  async storageSet(key, value) {
    this.#assert();
    await this.#monday.storage.instance.setItem(key, JSON.stringify(value));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Execute a GraphQL query via monday.api() and normalize error responses.
   *
   * monday.api() returns { data, errors, extensions } on HTTP 200.
   * Errors may be present WITHOUT throwing. This method normalizes that:
   * if errors exist, it throws a structured Error so the error handler can classify it.
   *
   * @param {string} query — GraphQL query string
   * @param {object} variables — GraphQL variables
   * @returns {Promise<object>} — The `data` field from the response
   * @throws {Error} — With `error.response` containing { errors, data, extensions }
   */
  async #execute(query, variables) {
    const response = await this.#monday.api(query, { variables });

    // monday.api() returns { data, errors, extensions } on HTTP 200
    // errors may be present WITHOUT throwing
    if (response?.errors?.length > 0) {
      const error = new Error(response.errors[0].message);
      error.response = {
        errors: response.errors,
        data: response.data,
        extensions: response.extensions,
      };
      throw error;
    }

    return response.data;
  }

  #assert() {
    if (!this.#initialized) throw new Error('Call mondayApi.init() first.');
  }
}

export const mondayApi = new MondayApiService();
export function createMondayApiService() { return new MondayApiService(); }
export { DEFAULT_API_VERSION as API_VERSION };
export default mondayApi;
