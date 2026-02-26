/**
 * errorHandler.js — Monday.com API Error Handler
 *
 * Handles two error shapes from monday.api():
 *
 *   Shape A — GraphQL errors in success response (HTTP 200):
 *     error.response.errors[] with extensions.code
 *
 *   Shape B — SDK throws plain Error:
 *     Error { message: "Graphql validation errors", data: { ... } }
 *
 * Error flow:
 *   1. Error happens → auto-retry if retryable
 *   2. If still fails → show nice message: "Something went wrong, please try again"
 *   3. If user retries and it fails AGAIN → show: "Send problem details" button
 *   4. Only when user clicks that button → errors are sent to Supabase
 *
 * Complete error codes from:
 * https://developer.monday.com/api-reference/docs/error-handling
 * API version 2026-01 (February 2026)
 */

import { logger } from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Error Codes — Complete from Monday.com docs
// ─────────────────────────────────────────────────────────────────────────────

export const ERROR_CODES = {
  // 2xx (HTTP 200)
  API_TEMPORARILY_BLOCKED:    'API_TEMPORARILY_BLOCKED',
  COLUMN_VALUE_EXCEPTION:     'ColumnValueException',
  CORRECTED_VALUE_EXCEPTION:  'CorrectedValueException',
  CREATE_BOARD_EXCEPTION:     'CreateBoardException',
  INVALID_ARGUMENT:           'InvalidArgumentException',
  INVALID_BOARD_ID:           'InvalidBoardIdException',
  INVALID_COLUMN_ID:          'InvalidColumnIdException',
  INVALID_USER_ID:            'InvalidUserIdException',
  INVALID_VERSION:            'InvalidVersionException',
  ITEM_NAME_TOO_LONG:         'ItemNameTooLongException',
  ITEMS_LIMITATION:           'ItemsLimitationException',
  MISSING_PERMISSIONS:        'missingRequiredPermissions',
  PARSE_ERROR:                'ParseError',
  RESOURCE_NOT_FOUND:         'ResourceNotFoundException',
  ASSET_UNAVAILABLE:          'ASSET_UNAVAILABLE',
  // 4xx
  BAD_REQUEST:                'BadRequest',
  JSON_PARSE_EXCEPTION:       'JsonParseException',
  UNAUTHORIZED:               'Unauthorized',
  IP_RESTRICTED:              'IpRestricted',
  USER_UNAUTHORIZED:          'USER_UNAUTHORIZED',
  USER_ACCESS_DENIED:         'USER_ACCESS_DENIED',
  DELETE_LAST_GROUP:          'DeleteLastGroupException',
  RECORD_INVALID:             'RecordInvalidException',
  RESOURCE_LOCKED:            'ResourceLocked',
  MAX_CONCURRENCY_EXCEEDED:   'maxConcurrencyExceeded',
  RATE_LIMIT_EXCEEDED:        'RateLimitExceeded',
  COMPLEXITY_BUDGET_EXHAUSTED:'COMPLEXITY_BUDGET_EXHAUSTED',
  IP_RATE_LIMIT_EXCEEDED:     'IP_RATE_LIMIT_EXCEEDED',
  DAILY_LIMIT_EXCEEDED:       'DAILY_LIMIT_EXCEEDED',
  // 5xx
  INTERNAL_SERVER_ERROR:      'InternalServerError',
  // Additional codes (API 2026-01)
  FIELD_LIMIT_EXCEEDED:       'FIELD_LIMIT_EXCEEDED',
  COMPLEXITY_EXCEPTION:       'ComplexityException',
  INVALID_ITEM_ID:            'InvalidItemIdException',
  REQUEST_MAX_COMPLEXITY_EXCEEDED: 'REQUEST_MAX_COMPLEXITY_EXCEEDED',
  // SDK / network
  TIMEOUT:                    'Timeout',
};

const RETRYABLE = new Set([
  ERROR_CODES.COMPLEXITY_BUDGET_EXHAUSTED, ERROR_CODES.RATE_LIMIT_EXCEEDED,
  ERROR_CODES.MAX_CONCURRENCY_EXCEEDED, ERROR_CODES.IP_RATE_LIMIT_EXCEEDED,
  ERROR_CODES.INTERNAL_SERVER_ERROR, ERROR_CODES.API_TEMPORARILY_BLOCKED,
  ERROR_CODES.RESOURCE_LOCKED, ERROR_CODES.FIELD_LIMIT_EXCEEDED,
  ERROR_CODES.COMPLEXITY_EXCEPTION, ERROR_CODES.REQUEST_MAX_COMPLEXITY_EXCEEDED,
  ERROR_CODES.DAILY_LIMIT_EXCEEDED, ERROR_CODES.TIMEOUT,
]);

const AUTH_ERRORS = new Set([
  ERROR_CODES.USER_UNAUTHORIZED, ERROR_CODES.USER_ACCESS_DENIED,
  ERROR_CODES.UNAUTHORIZED, ERROR_CODES.IP_RESTRICTED, ERROR_CODES.MISSING_PERMISSIONS,
]);

const VALIDATION_ERRORS = new Set([
  ERROR_CODES.COLUMN_VALUE_EXCEPTION, ERROR_CODES.CORRECTED_VALUE_EXCEPTION,
  ERROR_CODES.INVALID_ARGUMENT, ERROR_CODES.INVALID_BOARD_ID,
  ERROR_CODES.INVALID_COLUMN_ID, ERROR_CODES.INVALID_USER_ID,
  ERROR_CODES.INVALID_VERSION, ERROR_CODES.ITEM_NAME_TOO_LONG,
  ERROR_CODES.ITEMS_LIMITATION, ERROR_CODES.PARSE_ERROR,
  ERROR_CODES.RESOURCE_NOT_FOUND, ERROR_CODES.CREATE_BOARD_EXCEPTION,
  ERROR_CODES.DELETE_LAST_GROUP, ERROR_CODES.RECORD_INVALID,
  ERROR_CODES.BAD_REQUEST, ERROR_CODES.JSON_PARSE_EXCEPTION,
  ERROR_CODES.INVALID_ITEM_ID,
]);

// ── User Messages ───────────────────────────────────────────────────────────

export const MSG_HE = {
  [ERROR_CODES.COMPLEXITY_BUDGET_EXHAUSTED]: 'בקשות רבות מדי. אנא המתן מעט ונסה שוב.',
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]:         'חריגה ממגבלת בקשות לדקה. אנא המתן.',
  [ERROR_CODES.MAX_CONCURRENCY_EXCEEDED]:    'יותר מדי בקשות בו-זמנית. אנא נסה שוב.',
  [ERROR_CODES.IP_RATE_LIMIT_EXCEEDED]:      'חריגה ממגבלת בקשות. אנא המתן ונסה שוב.',
  [ERROR_CODES.DAILY_LIMIT_EXCEEDED]:        'הגעת למגבלת הבקשות היומית. נסה שוב מחר.',
  [ERROR_CODES.USER_UNAUTHORIZED]:           'אין לך הרשאה לבצע פעולה זו.',
  [ERROR_CODES.USER_ACCESS_DENIED]:          'הגישה נדחתה. ודא שהמשתמש פעיל ומאומת.',
  [ERROR_CODES.UNAUTHORIZED]:                'מפתח API לא תקין.',
  [ERROR_CODES.IP_RESTRICTED]:               'כתובת ה-IP שלך חסומה על ידי מנהל החשבון.',
  [ERROR_CODES.MISSING_PERMISSIONS]:         'לאפליקציה חסרות הרשאות. בדוק את הגדרות האפליקציה.',
  [ERROR_CODES.COLUMN_VALUE_EXCEPTION]:      'ערך שגוי בעמודה. בדוק את הפורמט.',
  [ERROR_CODES.CORRECTED_VALUE_EXCEPTION]:   'סוג הערך לא מתאים לעמודה זו.',
  [ERROR_CODES.INVALID_ARGUMENT]:            'ארגומנט לא תקין בבקשה.',
  [ERROR_CODES.INVALID_BOARD_ID]:            'מזהה הלוח לא תקין או שאין לך גישה.',
  [ERROR_CODES.INVALID_COLUMN_ID]:           'מזהה העמודה לא תקין.',
  [ERROR_CODES.INVALID_USER_ID]:             'מזהה המשתמש לא תקין.',
  [ERROR_CODES.INVALID_VERSION]:             'גרסת API לא תקינה.',
  [ERROR_CODES.ITEM_NAME_TOO_LONG]:          'שם הפריט ארוך מדי (מקסימום 255 תווים).',
  [ERROR_CODES.ITEMS_LIMITATION]:            'הלוח הגיע למגבלת 10,000 פריטים.',
  [ERROR_CODES.PARSE_ERROR]:                 'שגיאת תחביר בבקשה.',
  [ERROR_CODES.RESOURCE_NOT_FOUND]:          'הפריט המבוקש לא נמצא.',
  [ERROR_CODES.CREATE_BOARD_EXCEPTION]:      'שגיאה ביצירת לוח.',
  [ERROR_CODES.DELETE_LAST_GROUP]:           'לא ניתן למחוק את הקבוצה האחרונה בלוח.',
  [ERROR_CODES.RECORD_INVALID]:             'חריגה ממגבלת מנויים ללוח.',
  [ERROR_CODES.BAD_REQUEST]:                'מבנה הבקשה שגוי.',
  [ERROR_CODES.JSON_PARSE_EXCEPTION]:       'JSON לא תקין בבקשה.',
  [ERROR_CODES.RESOURCE_LOCKED]:            'הלוח נעול כרגע. נסה שוב בעוד רגע.',
  [ERROR_CODES.INTERNAL_SERVER_ERROR]:       'שגיאת שרת. אנא נסה שוב.',
  [ERROR_CODES.API_TEMPORARILY_BLOCKED]:     'ה-API זמנית לא זמין.',
  [ERROR_CODES.ASSET_UNAVAILABLE]:           'הקובץ אינו זמין.',
  [ERROR_CODES.FIELD_LIMIT_EXCEEDED]:        'חריגה ממגבלת בקשות מקבילות. אנא המתן ונסה שוב.',
  [ERROR_CODES.COMPLEXITY_EXCEPTION]:        'הבקשה מורכבת מדי. נסה לצמצם את כמות השדות.',
  [ERROR_CODES.INVALID_ITEM_ID]:             'מזהה הפריט לא תקין או שהפריט נמחק.',
  [ERROR_CODES.REQUEST_MAX_COMPLEXITY_EXCEEDED]: 'הבקשה מורכבת מדי. נסה לבקש פחות שדות.',
  [ERROR_CODES.TIMEOUT]:                     'הבקשה נכשלה בגלל timeout. אנא נסה שוב.',
  DEFAULT: 'אירעה שגיאה. אנא נסה שוב.',
};

export const MSG_EN = {
  [ERROR_CODES.COMPLEXITY_BUDGET_EXHAUSTED]: 'Too many requests. Please wait and try again.',
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]:         'Request limit per minute exceeded. Please wait.',
  [ERROR_CODES.MAX_CONCURRENCY_EXCEEDED]:    'Too many simultaneous requests. Please try again.',
  [ERROR_CODES.IP_RATE_LIMIT_EXCEEDED]:      'IP rate limit exceeded. Please wait and try again.',
  [ERROR_CODES.DAILY_LIMIT_EXCEEDED]:        'Daily request limit reached. Try again tomorrow.',
  [ERROR_CODES.USER_UNAUTHORIZED]:           "You don't have permission to perform this action.",
  [ERROR_CODES.USER_ACCESS_DENIED]:          'Access denied. Make sure your account is active and verified.',
  [ERROR_CODES.UNAUTHORIZED]:                'Invalid API key.',
  [ERROR_CODES.IP_RESTRICTED]:               'Your IP address is restricted by the account admin.',
  [ERROR_CODES.MISSING_PERMISSIONS]:         'App is missing required permissions.',
  [ERROR_CODES.COLUMN_VALUE_EXCEPTION]:      'Invalid column value format.',
  [ERROR_CODES.CORRECTED_VALUE_EXCEPTION]:   'Value type does not match this column.',
  [ERROR_CODES.INVALID_ARGUMENT]:            'Invalid argument in request.',
  [ERROR_CODES.INVALID_BOARD_ID]:            'Board ID is invalid or you lack access.',
  [ERROR_CODES.INVALID_COLUMN_ID]:           'Column ID is invalid.',
  [ERROR_CODES.INVALID_USER_ID]:             'User ID is invalid.',
  [ERROR_CODES.INVALID_VERSION]:             'Invalid API version.',
  [ERROR_CODES.ITEM_NAME_TOO_LONG]:          'Item name too long (max 255 characters).',
  [ERROR_CODES.ITEMS_LIMITATION]:            'Board has reached the 10,000 item limit.',
  [ERROR_CODES.PARSE_ERROR]:                 'Query syntax error.',
  [ERROR_CODES.RESOURCE_NOT_FOUND]:          'The requested resource was not found.',
  [ERROR_CODES.CREATE_BOARD_EXCEPTION]:      'Error creating board.',
  [ERROR_CODES.DELETE_LAST_GROUP]:           "Can't delete the last group on a board.",
  [ERROR_CODES.RECORD_INVALID]:             'Board subscriber limit exceeded.',
  [ERROR_CODES.BAD_REQUEST]:                'Bad request structure.',
  [ERROR_CODES.JSON_PARSE_EXCEPTION]:       'Invalid JSON in request.',
  [ERROR_CODES.RESOURCE_LOCKED]:            'Board is currently locked. Try again shortly.',
  [ERROR_CODES.INTERNAL_SERVER_ERROR]:       'Server error. Please try again.',
  [ERROR_CODES.API_TEMPORARILY_BLOCKED]:     'API is temporarily unavailable.',
  [ERROR_CODES.ASSET_UNAVAILABLE]:           'File is unavailable.',
  [ERROR_CODES.FIELD_LIMIT_EXCEEDED]:        'Field concurrency limit exceeded. Please wait and try again.',
  [ERROR_CODES.COMPLEXITY_EXCEPTION]:        'Query too complex. Try requesting fewer fields.',
  [ERROR_CODES.INVALID_ITEM_ID]:             'Item ID is invalid or the item has been deleted.',
  [ERROR_CODES.REQUEST_MAX_COMPLEXITY_EXCEEDED]: 'Request too complex. Try requesting fewer fields.',
  [ERROR_CODES.TIMEOUT]:                     'Request timed out. Please try again.',
  DEFAULT: 'An error occurred. Please try again.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Error Handler
// ─────────────────────────────────────────────────────────────────────────────

class ErrorHandler {
  /** @type {'he'|'en'} */
  #language;
  /** @type {object | null} */
  #monday;
  /** @type {number} */
  #maxRetries;
  /** @type {number} */
  #baseRetryMs;
  /** @type {Map<string, number>} Track consecutive failures per operation */
  #failureCount;

  // Auto-report config
  #autoReportEnabled;
  #autoReportMaxPerSession;
  #autoReportCount;
  /** @type {Set<string>} Fingerprints already auto-reported this session */
  #reportedFingerprints;

  /**
   * @param {object} [options]
   * @param {'he'|'en'} [options.language='he'] — Language for user messages
   * @param {object} [options.monday] — Monday SDK instance
   * @param {number} [options.maxRetries=3] — Max auto-retry attempts
   * @param {number} [options.baseRetryMs=1000] — Base delay for exponential backoff
   * @param {object} [options.autoReport] — Auto-report configuration
   * @param {boolean} [options.autoReport.enabled=false] — Enable automatic error reporting
   * @param {number} [options.autoReport.maxPerSession=10] — Max auto-reports per session
   */
  constructor(options = {}) {
    this.#language = options.language || 'he';
    this.#monday = options.monday || null;
    this.#maxRetries = options.maxRetries || 3;
    this.#baseRetryMs = options.baseRetryMs || 1000;
    this.#failureCount = new Map();
    this.#autoReportEnabled = options.autoReport?.enabled || false;
    this.#autoReportMaxPerSession = options.autoReport?.maxPerSession || 10;
    this.#autoReportCount = 0;
    this.#reportedFingerprints = new Set();
  }

  /**
   * Set the monday SDK instance (used for UI actions like notice).
   * @param {object} monday
   */
  setMondayInstance(monday) { this.#monday = monday; }

  /**
   * Set the language for user-facing messages.
   * @param {'he'|'en'} lang
   */
  setLanguage(lang) { this.#language = lang; }

  /**
   * Configure auto-report settings.
   * @param {object} config
   * @param {boolean} [config.enabled] — Enable/disable auto-reporting
   * @param {number} [config.maxPerSession] — Max auto-reports per session
   */
  setAutoReport(config) {
    if (config.enabled !== undefined) this.#autoReportEnabled = config.enabled;
    if (config.maxPerSession !== undefined) this.#autoReportMaxPerSession = config.maxPerSession;
  }

  // ── Main Handler ──────────────────────────────────────────────────────────

  /**
   * Classify an error and return a structured result.
   *
   * @param {Error | object} error — The error to handle
   * @param {object} [meta]
   * @param {string} [meta.operation='unknown'] — Operation name for tracking
   * @param {number} [meta.attempt=1] — Current retry attempt number
   * @param {boolean} [meta.silent=false] — Skip console logging (used by withRetry to log once at the end)
   * @returns {{
   *   category: 'rate_limit'|'auth'|'validation'|'server'|'network'|'unknown',
   *   code: string,
   *   httpStatus: number | null,
   *   message: string,
   *   userMessage: string,
   *   requestId: string | null,
   *   shouldRetry: boolean,
   *   canRetry: boolean,
   *   retryAfterMs: number | null,
   *   errors: object[],
   *   operation: string,
   *   attempt: number,
   *   consecutiveFailures: number,
   *   showSendReport: boolean,
   *   raw: object,
   * }}
   */
  handle(error, meta = {}) {
    const { operation = 'unknown', attempt = 1, silent = false } = meta;
    const errors = this.#extractErrors(error);
    const primary = errors[0] || {};
    const code = this.#extractCode(primary, error);
    const httpStatus = primary?.extensions?.status_code || error?.response?.status || null;
    const category = this.#classify(code, httpStatus);
    const shouldRetry = RETRYABLE.has(code);
    const canRetry = shouldRetry && attempt <= this.#maxRetries;
    const retryAfterMs = canRetry ? this.#calcRetryDelay(error, attempt) : null;
    const msgs = this.#language === 'en' ? MSG_EN : MSG_HE;
    const userMessage = msgs[code] || msgs.DEFAULT;
    const requestId = error?.response?.extensions?.request_id
      || errors[0]?.extensions?.request_id || null;

    // Track consecutive failures for this operation
    const failKey = operation;
    const prevFails = this.#failureCount.get(failKey) || 0;
    this.#failureCount.set(failKey, prevFails + 1);

    // Log full error to history (always needed for Supabase reports).
    // When silent=true (called by withRetry during retries), skip console output —
    // withRetry prints one clean full dump at the end instead.
    logger.apiError(operation, error, { historyOnly: silent });

    if (!silent && category === 'rate_limit') {
      logger.rateLimit(code, retryAfterMs ? retryAfterMs / 1000 : 0);
    }

    return {
      category, code, httpStatus,
      message: primary.message || error.message || 'Unknown error',
      userMessage, requestId,
      shouldRetry, canRetry, retryAfterMs,
      errors, operation, attempt,
      /** How many times this operation has failed consecutively. */
      consecutiveFailures: prevFails + 1,
      /** true if this is the 2nd+ failure → should show "send report" option. */
      showSendReport: prevFails + 1 >= 2,
      /** Error fingerprint for grouping/dedup. */
      fingerprint: this.#fingerprint(operation, code, primary?.message),
      /** Whether this error was auto-reported (set by withRetry). */
      autoReported: false,
      /** Full raw error response — for debugging / reporting. */
      raw: error?.response ?? error,
    };
  }

  /**
   * Reset the failure counter for an operation (call on success).
   * @param {string} operation
   */
  resetFailures(operation) {
    this.#failureCount.delete(operation);
  }

  /** Reset all failure counters. */
  resetAllFailures() {
    this.#failureCount.clear();
  }

  // ── Auto-Retry ────────────────────────────────────────────────────────────

  /**
   * Execute a function with automatic retry on retryable errors.
   *
   * @param {() => Promise<any>} fn — Async function to execute
   * @param {object} [options]
   * @param {string} [options.operation='unknown'] — Operation name for logging
   * @param {number} [options.maxRetries] — Override max retries (default: instance setting)
   * @returns {Promise<any>} — The result from fn()
   * @throws {Error} — If fn() fails with a non-retryable error or retries are exhausted
   */
  async withRetry(fn, options = {}) {
    const { operation = 'unknown', maxRetries = this.#maxRetries } = options;
    let lastResult = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await fn();
        // Success → reset failure counter
        this.resetFailures(operation);
        return result;
      } catch (error) {
        // Classify the error silently (history only, no console spam per attempt)
        lastResult = this.handle(error, { operation, attempt, silent: true });
        if (lastResult.canRetry && lastResult.retryAfterMs) {
          logger.info(`Retrying "${operation}" in ${lastResult.retryAfterMs}ms (${attempt}/${maxRetries + 1})`);
          await new Promise(r => setTimeout(r, lastResult.retryAfterMs));
          continue;
        }

        // Final failure — print full error ONCE to console for quick production debug
        logger.error(`✖ ${operation} failed [${lastResult.code}]`, {
          operation,
          code: lastResult.code,
          category: lastResult.category,
          fingerprint: lastResult.fingerprint,
          attempt,
          raw: lastResult.raw,
        });

        // Auto-report if enabled (silent — never pollutes console)
        if (this.#shouldAutoReport(lastResult)) {
          await this.#autoReport(lastResult);
          error._autoReported = true;
          error._fingerprint = lastResult.fingerprint;
        }

        throw error;
      }
    }
  }

  // ── Fingerprint & Auto-Report ─────────────────────────────────────────────

  /**
   * Generate a fingerprint for an error to enable grouping and dedup.
   * @param {string} operation
   * @param {string} code
   * @param {string} [message]
   * @returns {string} — Fingerprint string like 'fp-abc123'
   */
  #fingerprint(operation, code, message) {
    // Normalize message: strip variable parts (IDs, timestamps)
    const normalizedMsg = (message || '')
      .replace(/\d{5,}/g, '{id}')       // long numbers → {id}
      .replace(/"[^"]{20,}"/g, '{str}') // long strings → {str}
      .slice(0, 100);
    const raw = `${operation}:${code}:${normalizedMsg}`;
    // Simple hash — just for grouping, not security
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return `fp-${(hash >>> 0).toString(36)}`;
  }

  /**
   * Check if we should auto-report this error.
   * @param {object} result — handle() return value
   * @returns {boolean}
   */
  #shouldAutoReport(result) {
    if (!this.#autoReportEnabled) return false;
    if (!logger.isSupabaseReady) return false;
    if (this.#autoReportCount >= this.#autoReportMaxPerSession) return false;
    if (this.#reportedFingerprints.has(result.fingerprint)) return false;
    return true;
  }

  /**
   * Send an anonymous auto-report for this error.
   * @param {object} result — handle() return value
   */
  async #autoReport(result) {
    try {
      await logger.sendAnonymousEvent({
        fingerprint: result.fingerprint,
        error_code: result.code,
        operation: result.operation,
      });
      this.#reportedFingerprints.add(result.fingerprint);
      this.#autoReportCount++;
    } catch {
      // Silent failure — auto-report is best-effort, never pollutes console
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Extract the errors array from various error shapes.
   * @param {Error | object} error
   * @returns {object[]}
   */
  #extractErrors(error) {
    // Shape A: error.response.errors (from #execute normalization or SeamlessApiClient)
    if (error?.response?.errors) return error.response.errors;
    // Standard errors array on the error itself
    if (error?.errors) return error.errors;
    // Shape B: SDK throws plain Error with error.data (monday.api() SDK errors)
    if (error?.data?.errors) return error.data.errors;
    // Shape B variant: error.data has error_code (HTTP 429 style wrapped in SDK error)
    if (error?.data?.error_code) {
      return [{
        message: error.data.error_message || error.message,
        extensions: { code: error.data.error_code },
      }];
    }
    return [];
  }

  /**
   * Extract a machine-readable error code from the primary error object.
   * Falls back to message pattern matching for errors without extensions.code.
   *
   * @param {object} primary — First error from #extractErrors
   * @param {Error | object} original — The original thrown error
   * @returns {string} — An ERROR_CODES value or 'UNKNOWN'
   */
  #extractCode(primary, original) {
    if (primary?.extensions?.code) {
      const code = primary.extensions.code;
      // Legacy fallback: older API versions may still return the old name
      if (code === 'UserUnauthorizedException') return ERROR_CODES.USER_UNAUTHORIZED;
      return code;
    }
    const msg = primary?.message || original?.message || '';
    if (msg.startsWith('Parse error'))                return ERROR_CODES.PARSE_ERROR;
    if (/Graphql validation error/i.test(msg))        return ERROR_CODES.PARSE_ERROR;
    if (msg.includes('Complexity budget exhausted'))   return ERROR_CODES.COMPLEXITY_BUDGET_EXHAUSTED;
    if (msg.includes('Rate Limit'))                    return ERROR_CODES.RATE_LIMIT_EXCEEDED;
    if (msg.includes('concurrency'))                   return ERROR_CODES.MAX_CONCURRENCY_EXCEEDED;
    if (msg.includes('currently locked'))              return ERROR_CODES.RESOURCE_LOCKED;
    if (/timeout|Received timeout/i.test(msg))         return ERROR_CODES.TIMEOUT;
    if (/Not Authenticated/i.test(msg))                return ERROR_CODES.UNAUTHORIZED;
    return 'UNKNOWN';
  }

  /**
   * Classify an error code into a category.
   * @param {string} code
   * @param {number | null} httpStatus
   * @returns {'rate_limit'|'auth'|'validation'|'server'|'network'|'unknown'}
   */
  #classify(code, httpStatus) {
    if (RETRYABLE.has(code))         return 'rate_limit';
    if (AUTH_ERRORS.has(code))       return 'auth';
    if (VALIDATION_ERRORS.has(code)) return 'validation';
    if (httpStatus >= 500)           return 'server';
    if (code === 'UNKNOWN' && !httpStatus) return 'network';
    return 'unknown';
  }

  /**
   * Calculate retry delay using Retry-After header, extensions, or exponential backoff.
   * @param {Error | object} error
   * @param {number} attempt
   * @returns {number} — Delay in milliseconds
   */
  #calcRetryDelay(error, attempt) {
    const h = error?.response?.headers?.get?.('Retry-After') || error?.response?.headers?.['retry-after'];
    if (h) return parseInt(h, 10) * 1000;
    for (const err of this.#extractErrors(error)) {
      if (err?.extensions?.retry_in_seconds) return err.extensions.retry_in_seconds * 1000;
    }
    return Math.min(this.#baseRetryMs * Math.pow(2, attempt - 1) + Math.random() * 500, 30000);
  }
}

export const errorHandler = new ErrorHandler();
export function createErrorHandler(options) { return new ErrorHandler(options); }
export default errorHandler;
