/**
 * logger.js — Standardized Logger for Monday.com Client-Side Apps
 *
 * Key behavior:
 *   - All logs go to console + in-memory history
 *   - NOTHING is sent to Supabase automatically
 *   - Only when user clicks "Send problem details" → call logger.sendErrorReport()
 *   - That sends the last N error entries to Supabase in a single INSERT
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const LOG_COLORS = { debug: '#8B8B8B', info: '#2B76E5', warn: '#FDAB3D', error: '#E2445C' };
const LOG_ICONS  = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' };

class Logger {
  #level;
  #context;
  #prefix;
  #history;
  #maxHistory;

  // Supabase config (but never auto-sends)
  #supabaseUrl;
  #supabaseKey;
  #supabaseTable;
  #supabaseReady;

  constructor(options = {}) {
    this.#level = options.level || 'info';
    this.#context = options.context || {};
    this.#prefix = options.prefix || '[Monday App]';
    this.#history = [];
    this.#maxHistory = options.maxHistory || 200;
    this.#supabaseUrl = null;
    this.#supabaseKey = null;
    this.#supabaseTable = 'error_logs';
    this.#supabaseReady = false;
  }

  // ── Supabase Config ─────────────────────────────────────────────────────

  /**
   * Configure Supabase connection (does NOT auto-send anything).
   * Errors are only sent when user explicitly calls sendErrorReport().
   */
  initSupabase(supabaseUrl, anonKey, options = {}) {
    this.#supabaseUrl = supabaseUrl.replace(/\/$/, '');
    this.#supabaseKey = anonKey;
    this.#supabaseTable = options.table || 'error_logs';
    this.#supabaseReady = true;
  }

  get isSupabaseReady() {
    return this.#supabaseReady;
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  setLevel(level) {
    if (level in LOG_LEVELS) this.#level = level;
  }

  setContext(ctx) {
    this.#context = { ...this.#context, ...ctx };
  }

  clearContext() {
    this.#context = {};
  }

  // ── Log Methods ───────────────────────────────────────────────────────────

  debug(message, data) { this.#log('debug', message, data); }
  info(message, data)  { this.#log('info', message, data); }
  warn(message, data)  { this.#log('warn', message, data); }
  error(message, data) { this.#log('error', message, data); }

  // ── Monday API Helpers ────────────────────────────────────────────────────

  apiRequest(operation, variables) {
    this.debug(`→ API: ${operation}`, { operation, variables: variables || {} });
  }

  apiResponse(operation, response, durationMs) {
    const hasErrors = response?.errors?.length > 0;
    const requestId = response?.extensions?.request_id || null;
    this.#log(hasErrors ? 'warn' : 'debug', `← API: ${operation} (${durationMs}ms)`, {
      operation, durationMs, requestId, hasErrors,
      errors: hasErrors ? response.errors.map(e => ({
        code: e.extensions?.code, message: e.message, statusCode: e.extensions?.status_code,
      })) : undefined,
    });
  }

  apiError(operation, error) {
    const errors = error?.response?.errors || [];
    const requestId = error?.response?.extensions?.request_id
      || errors[0]?.extensions?.request_id || null;
    this.error(`✖ API Error: ${operation}`, {
      operation, requestId, message: error.message,
      errors: errors.map(e => ({
        code: e.extensions?.code, message: e.message,
        statusCode: e.extensions?.status_code, path: e.path,
      })),
    });
  }

  rateLimit(errorCode, retryAfterSeconds) {
    this.warn(`⏳ Rate Limited: ${errorCode}`, { errorCode, retryAfterSeconds });
  }

  // ── History ───────────────────────────────────────────────────────────────

  getHistory(count) {
    return count ? this.#history.slice(-count) : [...this.#history];
  }

  /** Get only error/warn entries from history. */
  getErrorHistory(count = 20) {
    const errors = this.#history.filter(e => e.level === 'error' || e.level === 'warn');
    return count ? errors.slice(-count) : errors;
  }

  /** Check if there are recent errors in the log. */
  hasRecentErrors(withinMs = 60000) {
    const cutoff = Date.now() - withinMs;
    return this.#history.some(e =>
      e.level === 'error' && new Date(e.timestamp).getTime() > cutoff
    );
  }

  exportHistory() {
    return JSON.stringify(this.#history, null, 2);
  }

  clearHistory() {
    this.#history = [];
  }

  // ── Send to Supabase (ONLY when user clicks "Send problem details") ─────

  /**
   * Send recent error logs to Supabase.
   * Called ONLY by user action (clicking the "send report" button).
   *
   * @param {object} [options]
   * @param {number} [options.maxEntries=20] — How many recent error entries to send
   * @param {string} [options.userNote]      — Optional user description of what happened
   * @returns {Promise<{ success: boolean, count: number }>}
   */
  async sendErrorReport(options = {}) {
    const { maxEntries = 20, userNote } = options;

    if (!this.#supabaseReady) {
      console.warn('[Logger] Supabase not configured. Call initSupabase() first.');
      return { success: false, count: 0 };
    }

    // Collect recent errors/warnings
    const entries = this.getErrorHistory(maxEntries);
    if (entries.length === 0) {
      return { success: true, count: 0 };
    }

    // Build a report ID to group all rows from this single report
    const reportId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Map entries to Supabase rows
    const rows = entries.map(entry => ({
      timestamp:    entry.timestamp,
      level:        entry.level,
      message:      entry.message,
      user_id:      this.#context.userId      || null,
      account_id:   this.#context.accountId   || null,
      board_id:     this.#context.boardId     || null,
      instance_id:  this.#context.instanceId  || null,
      app_id:       this.#context.appId       || null,
      request_id:   entry.data?.requestId     || null,
      error_code:   entry.data?.errors?.[0]?.code || entry.data?.errorCode || null,
      operation:    entry.data?.operation      || null,
      report_id:    reportId,
      user_note:    userNote || null,
      data:         entry.data ? JSON.stringify(entry.data) : null,
    }));

    try {
      const response = await fetch(`${this.#supabaseUrl}/rest/v1/${this.#supabaseTable}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.#supabaseKey,
          'Authorization': `Bearer ${this.#supabaseKey}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(rows), // Supabase supports bulk insert with array
      });

      if (!response.ok) {
        console.error('[Logger] Supabase insert failed:', response.status);
        return { success: false, count: 0 };
      }

      this.info('Error report sent successfully', { reportId, count: rows.length });
      return { success: true, count: rows.length, reportId };
    } catch (e) {
      console.error('[Logger] Failed to send error report:', e.message);
      return { success: false, count: 0 };
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  #log(level, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level, message,
      data: data || undefined,
      context: Object.keys(this.#context).length > 0 ? { ...this.#context } : undefined,
    };

    this.#history.push(entry);
    if (this.#history.length > this.#maxHistory) this.#history.shift();

    if (LOG_LEVELS[level] >= LOG_LEVELS[this.#level]) {
      const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'debug' ? 'debug' : 'log';
      const style = `color: ${LOG_COLORS[level]}; font-weight: bold;`;
      const prefix = `${LOG_ICONS[level]} ${this.#prefix} [${new Date().toLocaleTimeString()}]`;
      data
        ? console[fn](`%c${prefix} ${message}`, style, data)
        : console[fn](`%c${prefix} ${message}`, style);
    }

    // NO auto-send to Supabase. Only sendErrorReport() does that.
  }
}

export const logger = new Logger();
export function createLogger(options) { return new Logger(options); }
export default logger;
