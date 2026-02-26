/**
 * mondayApi.js — Unified Monday.com API Service (Client-Side Only)
 *
 * Wraps both SDKs:
 *   - monday-sdk-js        → context, UI, storage, listeners
 *   - @mondaydotcomorg/api  → SeamlessApiClient for CRUD (no token needed)
 *
 * Error handling flow:
 *   1. Auto-retry on rate limits (transparent to user)
 *   2. If still fails → error bubbles up to your component
 *   3. Your component uses <ErrorBanner> for the nice UX
 *   4. User clicks "Send problem details" → sends to Supabase
 *
 * Requires: npm i monday-sdk-js @mondaydotcomorg/api
 */

import mondaySdk from 'monday-sdk-js';
import { SeamlessApiClient } from '@mondaydotcomorg/api';
import { logger } from './logger.js';
import { errorHandler } from './errorHandler.js';

const API_VERSION = '2026-01';
const DEFAULT_PAGE_LIMIT = 50;

class MondayApiService {
  #monday;
  #apiClient;
  #context;
  #initialized;

  constructor() {
    this.#monday = null;
    this.#apiClient = null;
    this.#context = null;
    this.#initialized = false;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(options = {}) {
    const { language = 'he', logLevel = 'info', supabase } = options;

    this.#monday = mondaySdk();
    this.#apiClient = new SeamlessApiClient();
    logger.setLevel(logLevel);
    errorHandler.setMondayInstance(this.#monday);
    errorHandler.setLanguage(language);

    try {
      const res = await this.#monday.get('context');
      this.#context = res.data;
      logger.setContext({
        userId:     this.#context.user?.id,
        accountId:  this.#context.account?.id,
        boardId:    this.#context.boardId,
        instanceId: this.#context.instanceId,
        appId:      this.#context.app?.id,
        theme:      this.#context.theme,
      });
    } catch (e) {
      this.#context = {};
    }

    if (supabase?.url && supabase?.anonKey) {
      logger.initSupabase(supabase.url, supabase.anonKey, {
        table: supabase.table,
      });
    }

    logger.info('Monday API Service initialized', {
      boardId: this.#context.boardId, apiVersion: API_VERSION, language,
    });

    this.#initialized = true;
    return this.#context;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get monday()    { this.#assert(); return this.#monday; }
  get apiClient() { this.#assert(); return this.#apiClient; }
  get context()   { return this.#context; }
  get boardId()   { return this.#context?.boardId; }
  get user()      { return this.#context?.user; }
  get theme()     { return this.#context?.theme; }

  // ── Raw GraphQL ───────────────────────────────────────────────────────────

  async query(query, variables = {}, options = {}) {
    this.#assert();
    const { operation = 'graphql', retry = true } = options;

    const execute = async () => {
      const start = performance.now();
      logger.apiRequest(operation, variables);
      const data = await this.#apiClient.request(query, variables);
      logger.apiResponse(operation, { data, extensions: data?.extensions }, Math.round(performance.now() - start));
      return data;
    };

    return retry ? errorHandler.withRetry(execute, { operation }) : execute();
  }

  // ── Items CRUD ────────────────────────────────────────────────────────────

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

  async updateColumnValue(boardId, itemId, columnId, value) {
    const data = await this.query(`
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }`, { boardId: String(boardId), itemId: String(itemId), columnId, value: JSON.stringify(value) },
      { operation: 'updateColumnValue' });
    return data.change_column_value;
  }

  async updateSimpleColumnValue(boardId, itemId, columnId, value) {
    const data = await this.query(`
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
        change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }`, { boardId: String(boardId), itemId: String(itemId), columnId, value: String(value) },
      { operation: 'updateSimpleColumnValue' });
    return data.change_simple_column_value;
  }

  async updateMultipleColumnValues(boardId, itemId, columnValues, options = {}) {
    const { createLabelsIfMissing = false } = options;
    const data = await this.query(`
      mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues${createLabelsIfMissing ? ', create_labels_if_missing: true' : ''}) { id }
      }`, { boardId: String(boardId), itemId: String(itemId), columnValues: JSON.stringify(columnValues) },
      { operation: 'updateMultipleColumnValues' });
    return data.change_multiple_column_values;
  }

  async deleteItem(itemId) {
    const data = await this.query(`
      mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }
    `, { itemId: String(itemId) }, { operation: 'deleteItem' });
    return data.delete_item;
  }

  // ── Board ─────────────────────────────────────────────────────────────────

  async getBoard(boardId) {
    const data = await this.query(`
      query ($ids: [ID!]) {
        boards(ids: $ids) { id name description state permissions columns { id title type settings_str } groups { id title color position } owners { id name } }
      }`, { ids: [String(boardId)] }, { operation: 'getBoard' });
    return data.boards?.[0] || null;
  }

  // ── Subitems ──────────────────────────────────────────────────────────────

  async createSubitem(parentItemId, itemName, columnValues = {}) {
    const data = await this.query(`
      mutation ($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
        create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) { id name board { id } }
      }`, { parentItemId: String(parentItemId), itemName, columnValues: JSON.stringify(columnValues) },
      { operation: 'createSubitem' });
    return data.create_subitem;
  }

  // ── UI Helpers ────────────────────────────────────────────────────────────

  async notice(message, type = 'info', timeout = 5000) {
    this.#assert();
    try { await this.#monday.execute('notice', { message, type, timeout }); } catch (e) { /* */ }
  }

  async confirm(message, confirmButton = 'אישור', cancelButton = 'ביטול') {
    this.#assert();
    try {
      const res = await this.#monday.execute('confirm', { message, confirmButton, cancelButton });
      return res?.data?.confirm || false;
    } catch (e) { return false; }
  }

  onSettingsChange(cb) { this.#assert(); return this.#monday.listen('settings', r => cb(r.data)); }
  onContextChange(cb)  { this.#assert(); return this.#monday.listen('context', r => { this.#context = r.data; cb(r.data); }); }
  async getSettings()  { this.#assert(); return (await this.#monday.get('settings')).data; }

  // ── Storage ───────────────────────────────────────────────────────────────

  async storageGet(key) {
    this.#assert();
    const res = await this.#monday.storage.instance.getItem(key);
    return res?.data?.value ? JSON.parse(res.data.value) : null;
  }

  async storageSet(key, value) {
    this.#assert();
    await this.#monday.storage.instance.setItem(key, JSON.stringify(value));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  #assert() {
    if (!this.#initialized) throw new Error('Call mondayApi.init() first.');
  }
}

export const mondayApi = new MondayApiService();
export function createMondayApiService() { return new MondayApiService(); }
export { API_VERSION };
export default mondayApi;
