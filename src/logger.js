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
  #alwaysLogErrors;

  // Supabase config (but never auto-sends)
  #supabaseUrl;
  #supabaseKey;
  #supabaseTable;
  #supabaseReady;

  // Breadcrumbs — ring buffer of recent events for debugging context
  #breadcrumbs;
  #maxBreadcrumbs;

  /**
   * @param {object} [options]
   * @param {string} [options.level='info'] — Log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
   * @param {object} [options.context={}] — Initial context (userId, boardId, etc.)
   * @param {string} [options.prefix='[Monday App]'] — Console log prefix
   * @param {number} [options.maxHistory=200] — Max in-memory log entries
   * @param {boolean} [options.alwaysLogErrors=true] — Always print error-level messages to console, even if log level is higher
   * @param {number} [options.maxBreadcrumbs=30] — Max breadcrumb entries in ring buffer
   */
  constructor(options = {}) {
    this.#level = options.level || 'info';
    this.#context = options.context || {};
    this.#prefix = options.prefix || '[Monday App]';
    this.#history = [];
    this.#maxHistory = options.maxHistory || 200;
    this.#alwaysLogErrors = options.alwaysLogErrors !== undefined ? options.alwaysLogErrors : true;
    this.#supabaseUrl = null;
    this.#supabaseKey = null;
    this.#supabaseTable = 'error_logs';
    this.#supabaseReady = false;
    this.#breadcrumbs = [];
    this.#maxBreadcrumbs = options.maxBreadcrumbs || 30;
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

  /**
   * Set the minimum log level for console output.
   * @param {'debug'|'info'|'warn'|'error'|'silent'} level
   */
  setLevel(level) {
    if (level in LOG_LEVELS) this.#level = level;
  }

  /**
   * Merge additional context (userId, boardId, etc.) into log entries.
   * @param {object} ctx
   */
  setContext(ctx) {
    this.#context = { ...this.#context, ...ctx };
  }

  /** Clear all context. */
  clearContext() {
    this.#context = {};
  }

  // ── Breadcrumbs ─────────────────────────────────────────────────────────

  /**
   * Add a breadcrumb to the ring buffer for debugging context.
   * @param {string} category — Breadcrumb category (e.g. 'api', 'ui', 'navigation')
   * @param {string} message — Short description of what happened
   * @param {object} [data] — Optional structured data
   * @param {'debug'|'info'|'warn'|'error'} [level='info'] — Breadcrumb severity
   */
  addBreadcrumb(category, message, data, level = 'info') {
    const crumb = {
      timestamp: new Date().toISOString(),
      category,
      message,
      data: data || undefined,
      level,
    };
    this.#breadcrumbs.push(crumb);
    if (this.#breadcrumbs.length > this.#maxBreadcrumbs) this.#breadcrumbs.shift();
  }

  /**
   * Get a copy of the breadcrumbs buffer.
   * @returns {object[]}
   */
  getBreadcrumbs() {
    return [...this.#breadcrumbs];
  }

  /**
   * Get anonymized breadcrumbs (API operations only, no variables/user data).
   * Used for auto-reporting where privacy is important.
   * @returns {object[]}
   */
  getAnonymizedBreadcrumbs() {
    return this.#breadcrumbs
      .filter(b => b.category.startsWith('api'))
      .map(b => ({
        timestamp: b.timestamp,
        category: b.category,
        message: b.message,
        level: b.level,
        // Only include safe fields from data — no variables, no user data
        data: b.data ? {
          durationMs: b.data.durationMs,
          hasErrors: b.data.hasErrors,
          code: b.data.code,
        } : undefined,
      }));
  }

  /** Clear all breadcrumbs. */
  clearBreadcrumbs() {
    this.#breadcrumbs = [];
  }

  // ── Log Methods ───────────────────────────────────────────────────────────

  /**
   * Log a debug-level message.
   * @param {string} message
   * @param {object} [data]
   */
  debug(message, data) { this.#log('debug', message, data); }

  /**
   * Log an info-level message.
   * @param {string} message
   * @param {object} [data]
   */
  info(message, data)  { this.#log('info', message, data); }

  /**
   * Log a warn-level message.
   * @param {string} message
   * @param {object} [data]
   */
  warn(message, data)  { this.#log('warn', message, data); }

  /**
   * Log an error-level message. Always printed to console if `alwaysLogErrors` is true.
   * @param {string} message
   * @param {object} [data]
   */
  error(message, data) { this.#log('error', message, data); }

  // ── Monday API Helpers ────────────────────────────────────────────────────

  /**
   * Log an outgoing API request (debug level).
   * @param {string} operation — Operation name
   * @param {object} [variables] — GraphQL variables
   */
  apiRequest(operation, variables) {
    this.debug(`→ API: ${operation}`, { operation, variables: variables || {} });
    this.addBreadcrumb('api', `→ ${operation}`, { variables: variables || {} });
  }

  /**
   * Log an API response with timing info.
   * @param {string} operation — Operation name
   * @param {object} response — The API response
   * @param {number} durationMs — Request duration in milliseconds
   */
  apiResponse(operation, response, durationMs) {
    const hasErrors = response?.errors?.length > 0;
    const requestId = response?.extensions?.request_id || null;
    this.#log(hasErrors ? 'warn' : 'debug', `← API: ${operation} (${durationMs}ms)`, {
      operation, durationMs, requestId, hasErrors,
      errors: hasErrors ? response.errors.map(e => ({
        code: e.extensions?.code, message: e.message, statusCode: e.extensions?.status_code,
      })) : undefined,
    });
    this.addBreadcrumb('api', `← ${operation} (${durationMs}ms)`, { durationMs, hasErrors });
  }

  /**
   * Log an API error with full details for debugging and reporting.
   * @param {string} operation — Operation name
   * @param {Error | object} error — The error object
   * @param {object} [options]
   * @param {boolean} [options.historyOnly=false] — Only write to history, skip console output
   */
  apiError(operation, error, options = {}) {
    const response = error?.response;
    const errors = response?.errors || error?.errors || [];
    const requestId = response?.extensions?.request_id
      || errors[0]?.extensions?.request_id || null;

    // Extract top-level error fields (HTTP 429/401/403 responses without errors[])
    const topLevelCode = response?.error_code || error?.error_code || null;
    const topLevelMessage = response?.error_message || error?.error_message || null;

    const errorCode = errors[0]?.extensions?.code || topLevelCode || null;
    this.#log('error', `✖ API Error: ${operation}`, {
      operation, requestId, message: error?.message || topLevelMessage,
      errors: errors.length > 0
        ? errors.map(e => ({
            code: e.extensions?.code, message: e.message,
            statusCode: e.extensions?.status_code, path: e.path,
          }))
        : topLevelCode ? [{ code: topLevelCode, message: topLevelMessage }] : [],
      // Full raw — deep-cloned to avoid data loss from mutation
      rawResponse: Logger.#safeSerialize(response ?? error),
    }, options.historyOnly);
    this.addBreadcrumb('api.error', `✖ ${operation}`, { code: errorCode }, 'error');
  }

  /**
   * Log a rate limit event.
   * @param {string} errorCode — The rate limit error code
   * @param {number} retryAfterSeconds — Seconds to wait before retrying
   */
  rateLimit(errorCode, retryAfterSeconds) {
    this.warn(`⏳ Rate Limited: ${errorCode}`, { errorCode, retryAfterSeconds });
  }

  // ── History ───────────────────────────────────────────────────────────────

  /**
   * Get log history entries.
   * @param {number} [count] — Limit to last N entries. Omit for all.
   * @returns {object[]}
   */
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

  /**
   * Export full history as formatted JSON string.
   * @returns {string}
   */
  exportHistory() {
    return JSON.stringify(this.#history, null, 2);
  }

  /** Clear all history entries. */
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
   * @param {string} [options.fingerprint]   — Error fingerprint (links to anonymous events)
   * @returns {Promise<{ success: boolean, count: number }>}
   */
  async sendErrorReport(options = {}) {
    const { maxEntries = 20, userNote, fingerprint } = options;

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

    // Include breadcrumbs for debugging context
    const breadcrumbs = this.getBreadcrumbs();

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
      fingerprint:  fingerprint || null,
      app_version:  this.#context.appVersion   || null,
      environment:  this.#context.environment  || null,
      breadcrumbs:  breadcrumbs.length > 0 ? JSON.stringify(breadcrumbs) : null,
      report_type:  'user',
      data:         entry.data ? Logger.#safeStringify(entry.data) : null,
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
        this.debug('[Logger] Supabase insert failed', { status: response.status });
        return { success: false, count: 0 };
      }

      this.info('Error report sent successfully', { reportId, count: rows.length });
      return { success: true, count: rows.length, reportId };
    } catch (e) {
      this.debug('[Logger] Failed to send error report', { error: e.message });
      return { success: false, count: 0 };
    }
  }

  /**
   * Send an anonymous error event to Supabase (auto-reported, no PII).
   * Used for automatic error reporting when retries are exhausted.
   *
   * @param {object} eventData
   * @param {string} eventData.fingerprint — Error fingerprint for grouping
   * @param {string} [eventData.error_code] — Error code (e.g. 'ColumnValueException')
   * @param {string} [eventData.operation] — Operation name (e.g. 'createItem')
   * @returns {Promise<{ success: boolean }>}
   */
  async sendAnonymousEvent(eventData) {
    if (!this.#supabaseReady) {
      return { success: false };
    }

    const payload = {
      fingerprint:  eventData.fingerprint,
      error_code:   eventData.error_code || null,
      operation:    eventData.operation || null,
      app_version:  this.#context.appVersion || null,
      environment:  this.#context.environment || null,
      breadcrumbs:  this.getAnonymizedBreadcrumbs(),
    };

    try {
      // Use RPC function instead of direct INSERT — validates + rate-limits server-side
      const response = await fetch(`${this.#supabaseUrl}/rest/v1/rpc/insert_error_event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.#supabaseKey,
          'Authorization': `Bearer ${this.#supabaseKey}`,
        },
        body: JSON.stringify({ payload }),
      });

      if (!response.ok) {
        // Silent failure — auto-report is best-effort, don't pollute console
        return { success: false };
      }

      return { success: true };
    } catch {
      // Silent failure — auto-report is best-effort
      return { success: false };
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * @param {string} level
   * @param {string} message
   * @param {object} [data]
   * @param {boolean} [historyOnly=false] — Write to history but skip console output
   */
  #log(level, message, data, historyOnly = false) {
    const entry = {
      timestamp: new Date().toISOString(),
      level, message,
      data: data || undefined,
      context: Object.keys(this.#context).length > 0 ? { ...this.#context } : undefined,
    };

    this.#history.push(entry);
    if (this.#history.length > this.#maxHistory) this.#history.shift();

    if (historyOnly) return;

    const shouldOutput = LOG_LEVELS[level] >= LOG_LEVELS[this.#level];
    const forceError = this.#alwaysLogErrors && level === 'error';

    if (shouldOutput || forceError) {
      const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : level === 'debug' ? 'debug' : 'log';
      const style = `color: ${LOG_COLORS[level]}; font-weight: bold;`;
      const prefix = `${LOG_ICONS[level]} ${this.#prefix} [${new Date().toLocaleTimeString()}]`;
      data
        ? console[fn](`%c${prefix} ${message}`, style, data)
        : console[fn](`%c${prefix} ${message}`, style);
    }
  }

  // ── Safe Serialization ───────────────────────────────────────────────────

  /**
   * Deep-clone any value into a plain object safe for JSON.stringify.
   * Captures a full snapshot so data isn't lost if the original mutates.
   * Handles: Error objects (non-enumerable props), circular refs, DOM nodes.
   *
   * @param {any} obj — Value to serialize
   * @param {number} [depth=8] — Max recursion depth
   * @param {WeakSet} [seen] — Circular reference tracker
   */
  static #safeSerialize(obj, depth = 8, seen = new WeakSet()) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object' && typeof obj !== 'function') return obj;
    if (typeof obj === 'function') return '[Function]';
    // Avoid DOM nodes, streams, etc.
    if (typeof obj.pipe === 'function' || typeof obj.nodeType === 'number') return '[Non-serializable]';
    // Circular reference check
    if (seen.has(obj)) return '[Circular]';
    // Depth limit
    if (depth <= 0) return '[Max depth]';

    seen.add(obj);

    if (obj instanceof Error) {
      const result = {
        name: obj.name,
        message: obj.message,
        stack: obj.stack,
      };
      // Capture custom enumerable props (e.g. error.response, error.code)
      for (const [k, v] of Object.entries(obj)) {
        result[k] = Logger.#safeSerialize(v, depth - 1, seen);
      }
      return result;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => Logger.#safeSerialize(item, depth - 1, seen));
    }

    // Plain object — deep clone
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = Logger.#safeSerialize(v, depth - 1, seen);
    }
    return result;
  }

  /**
   * JSON.stringify that never throws — catches circular refs.
   */
  static #safeStringify(data) {
    try {
      const seen = new WeakSet();
      return JSON.stringify(data, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (value instanceof Error) {
            return { name: value.name, message: value.message, stack: value.stack, ...value };
          }
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      });
    } catch {
      return JSON.stringify({ serializationError: true, message: String(data) });
    }
  }
}

export const logger = new Logger();
export function createLogger(options) { return new Logger(options); }
export default logger;
