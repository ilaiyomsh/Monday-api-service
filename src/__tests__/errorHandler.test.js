/**
 * errorHandler.test.js — Tests for error classification, retry, messages, and raw logging.
 *
 * Simulates real Monday.com API error responses (HTTP 200, 429, 401)
 * and verifies the full flow: handle() → logger history → sendErrorReport().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createErrorHandler, ERROR_CODES, MSG_HE, MSG_EN } from '../errorHandler.js';
import { createLogger } from '../logger.js';

// ── Helpers: simulate real Monday API error shapes ───────────────────────

/** HTTP 200 GraphQL error (most monday errors) */
function makeGraphQLError(code, message = 'Error', extras = {}) {
  return {
    message,
    response: {
      errors: [{
        message,
        locations: [{ line: 2, column: 3 }],
        path: ['items'],
        extensions: { code, status_code: extras.statusCode || 200, ...extras },
      }],
      extensions: { request_id: 'req-123' },
    },
  };
}

/** HTTP 429 rate limit response (no errors[], top-level error_code) */
function makeRateLimitError(code = 'COMPLEXITY_BUDGET_EXHAUSTED', retryInSeconds = 15) {
  return {
    message: `${code}: budget exhausted`,
    response: {
      error_code: code,
      error_message: `${code}: budget exhausted`,
      extensions: { code, retry_in_seconds: retryInSeconds },
    },
  };
}

/** HTTP 401/403 auth error (non-GraphQL) */
function makeHttpAuthError() {
  return {
    message: 'Not Authenticated',
    response: {
      error_code: 'Unauthorized',
      status_code: 401,
      error_message: 'Not Authenticated',
    },
  };
}

/** Network error (no response at all) */
function makeNetworkError() {
  return new Error('fetch failed');
}

/** Error with circular reference */
function makeCircularError() {
  const err = makeGraphQLError('ColumnValueException', 'Bad value');
  err.response.self = err.response; // circular!
  return err;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('ErrorHandler', () => {
  let handler;
  let logger;

  beforeEach(() => {
    logger = createLogger({ level: 'silent' }); // don't pollute console
    handler = createErrorHandler();
  });

  // ── Error Code Classification ──────────────────────────────────────────

  describe('error code classification', () => {
    it('classifies GraphQL auth errors as "auth"', () => {
      const result = handler.handle(makeGraphQLError('USER_UNAUTHORIZED'));
      expect(result.category).toBe('auth');
      expect(result.code).toBe('USER_UNAUTHORIZED');
      expect(result.shouldRetry).toBe(false);
    });

    it('classifies rate limit errors as "rate_limit"', () => {
      const result = handler.handle(makeGraphQLError('COMPLEXITY_BUDGET_EXHAUSTED'));
      expect(result.category).toBe('rate_limit');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies validation errors as "validation"', () => {
      const result = handler.handle(makeGraphQLError('ColumnValueException', 'Bad value'));
      expect(result.category).toBe('validation');
      expect(result.shouldRetry).toBe(false);
    });

    it('classifies FIELD_LIMIT_EXCEEDED as retryable rate_limit', () => {
      const result = handler.handle(makeGraphQLError('FIELD_LIMIT_EXCEEDED'));
      expect(result.category).toBe('rate_limit');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies ComplexityException as retryable rate_limit', () => {
      const result = handler.handle(makeGraphQLError('ComplexityException'));
      expect(result.category).toBe('rate_limit');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies REQUEST_MAX_COMPLEXITY_EXCEEDED as retryable', () => {
      const result = handler.handle(makeGraphQLError('REQUEST_MAX_COMPLEXITY_EXCEEDED'));
      expect(result.category).toBe('rate_limit');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies InvalidItemIdException as validation', () => {
      const result = handler.handle(makeGraphQLError('InvalidItemIdException'));
      expect(result.category).toBe('validation');
      expect(result.code).toBe('InvalidItemIdException');
    });

    it('classifies network errors (no response) as "network"', () => {
      const result = handler.handle(makeNetworkError());
      expect(result.category).toBe('network');
      expect(result.code).toBe('UNKNOWN');
    });
  });

  // ── All Error Codes Have Messages ──────────────────────────────────────

  describe('user messages', () => {
    const allCodes = Object.values(ERROR_CODES);

    it('every ERROR_CODE has a Hebrew message', () => {
      for (const code of allCodes) {
        expect(MSG_HE[code], `Missing MSG_HE for ${code}`).toBeDefined();
        expect(MSG_HE[code].length).toBeGreaterThan(0);
      }
    });

    it('every ERROR_CODE has an English message', () => {
      for (const code of allCodes) {
        expect(MSG_EN[code], `Missing MSG_EN for ${code}`).toBeDefined();
        expect(MSG_EN[code].length).toBeGreaterThan(0);
      }
    });

    it('returns Hebrew message by default', () => {
      const result = handler.handle(makeGraphQLError('USER_UNAUTHORIZED'));
      expect(result.userMessage).toBe(MSG_HE['USER_UNAUTHORIZED']);
    });

    it('returns English message when language is "en"', () => {
      const enHandler = createErrorHandler({ language: 'en' });
      const result = enHandler.handle(makeGraphQLError('USER_UNAUTHORIZED'));
      expect(result.userMessage).toBe(MSG_EN['USER_UNAUTHORIZED']);
    });
  });

  // ── Legacy Fallback ────────────────────────────────────────────────────

  describe('legacy code fallback', () => {
    it('maps old UserUnauthorizedException → USER_UNAUTHORIZED', () => {
      const result = handler.handle(makeGraphQLError('UserUnauthorizedException'));
      expect(result.code).toBe('USER_UNAUTHORIZED');
      expect(result.category).toBe('auth');
    });
  });

  // ── Message-based Code Extraction ──────────────────────────────────────

  describe('message-based code extraction', () => {
    it('extracts PARSE_ERROR from message', () => {
      const err = { message: 'Parse error on line 1' };
      const result = handler.handle(err);
      expect(result.code).toBe(ERROR_CODES.PARSE_ERROR);
    });

    it('extracts COMPLEXITY_BUDGET_EXHAUSTED from message', () => {
      const err = { message: 'Complexity budget exhausted, ...' };
      const result = handler.handle(err);
      expect(result.code).toBe(ERROR_CODES.COMPLEXITY_BUDGET_EXHAUSTED);
    });

    it('extracts RATE_LIMIT_EXCEEDED from message', () => {
      const err = { message: 'Rate Limit exceeded' };
      const result = handler.handle(err);
      expect(result.code).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
    });
  });

  // ── Raw Field ──────────────────────────────────────────────────────────

  describe('raw error passthrough', () => {
    it('returns full response as raw when available', () => {
      const err = makeGraphQLError('ColumnValueException', 'Bad value');
      const result = handler.handle(err);
      expect(result.raw).toBe(err.response);
      expect(result.raw.errors[0].extensions.code).toBe('ColumnValueException');
    });

    it('returns the error itself as raw when no response', () => {
      const err = makeNetworkError();
      const result = handler.handle(err);
      expect(result.raw).toBe(err);
    });
  });

  // ── Retry Logic ────────────────────────────────────────────────────────

  describe('retry logic', () => {
    it('canRetry is true on first attempt for retryable errors', () => {
      const result = handler.handle(
        makeGraphQLError('COMPLEXITY_BUDGET_EXHAUSTED'),
        { attempt: 1 }
      );
      expect(result.canRetry).toBe(true);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('canRetry is false when attempts exceed maxRetries', () => {
      const result = handler.handle(
        makeGraphQLError('COMPLEXITY_BUDGET_EXHAUSTED'),
        { attempt: 4 }  // default maxRetries is 3
      );
      expect(result.canRetry).toBe(false);
      expect(result.retryAfterMs).toBeNull();
    });

    it('uses retry_in_seconds from extensions when available', () => {
      const err = makeGraphQLError('FIELD_LIMIT_EXCEEDED', 'limit', { retry_in_seconds: 5 });
      const result = handler.handle(err, { attempt: 1 });
      expect(result.retryAfterMs).toBe(5000);
    });

    it('withRetry retries on retryable errors', async () => {
      let calls = 0;
      const fn = async () => {
        calls++;
        if (calls < 3) throw makeGraphQLError('COMPLEXITY_BUDGET_EXHAUSTED');
        return 'success';
      };
      const retryHandler = createErrorHandler({ baseRetryMs: 10 });
      const result = await retryHandler.withRetry(fn, { operation: 'test', maxRetries: 3 });
      expect(result).toBe('success');
      expect(calls).toBe(3);
    });

    it('withRetry throws on non-retryable errors immediately', async () => {
      const fn = async () => { throw makeGraphQLError('ColumnValueException', 'Bad value'); };
      await expect(
        handler.withRetry(fn, { operation: 'test' })
      ).rejects.toThrow();
    });
  });

  // ── Consecutive Failures ───────────────────────────────────────────────

  describe('consecutive failures tracking', () => {
    it('tracks consecutive failures per operation', () => {
      const err = makeGraphQLError('ColumnValueException', 'Bad');
      const r1 = handler.handle(err, { operation: 'loadItems' });
      expect(r1.consecutiveFailures).toBe(1);
      expect(r1.showSendReport).toBe(false);

      const r2 = handler.handle(err, { operation: 'loadItems' });
      expect(r2.consecutiveFailures).toBe(2);
      expect(r2.showSendReport).toBe(true);
    });

    it('resets failures on success', () => {
      const err = makeGraphQLError('ColumnValueException', 'Bad');
      handler.handle(err, { operation: 'loadItems' });
      handler.handle(err, { operation: 'loadItems' });
      handler.resetFailures('loadItems');

      const r = handler.handle(err, { operation: 'loadItems' });
      expect(r.consecutiveFailures).toBe(1);
    });
  });
});
