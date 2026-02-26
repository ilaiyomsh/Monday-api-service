/**
 * ErrorBanner.jsx — Nice error UX for Monday.com apps
 *
 * Two-step flow:
 *   Step 1 (first failure):  "משהו השתבש. אנא נסה שוב" + retry button
 *   Step 2 (second failure): Same message + "שלח פרטי תקלה" button → sends to Supabase
 *
 * Usage:
 *   import { ErrorBanner, useErrorHandler } from './ErrorBanner';
 *
 *   function MyComponent() {
 *     const { error, handleError, clearError, retry } = useErrorHandler();
 *
 *     async function doSomething() {
 *       try {
 *         clearError();
 *         await mondayApi.createItem(boardId, 'test');
 *       } catch (e) {
 *         handleError(e, { operation: 'createItem', retryFn: doSomething });
 *       }
 *     }
 *
 *     return (
 *       <div>
 *         <ErrorBanner error={error} onRetry={retry} onDismiss={clearError} />
 *         <button onClick={doSomething}>Create Item</button>
 *       </div>
 *     );
 *   }
 */

import React, { useState, useCallback, useRef } from 'react';
import { errorHandler } from './errorHandler.js';
import { logger } from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useErrorHandler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * React hook for the two-step error UX.
 *
 * @param {object} [options]
 * @param {'he'|'en'} [options.language='he']
 * @returns {{ error, handleError, clearError, retry }}
 */
export function useErrorHandler(options = {}) {
  const { language = 'he' } = options;
  const [error, setError] = useState(null);
  const retryFnRef = useRef(null);

  const handleError = useCallback((err, meta = {}) => {
    const { operation, retryFn } = meta;
    const result = errorHandler.handle(err, { operation });

    // Store retry function for the retry button
    if (retryFn) retryFnRef.current = retryFn;

    setError({
      ...result,
      // Carry auto-report status from withRetry (marked on the error object)
      autoReported: err._autoReported || result.autoReported || false,
      fingerprint: err._fingerprint || result.fingerprint,
      language,
    });
  }, [language]);

  const clearError = useCallback(() => {
    setError(null);
    retryFnRef.current = null;
  }, []);

  const retry = useCallback(async () => {
    if (!retryFnRef.current) return;
    const fn = retryFnRef.current;
    setError(null);

    // The retryFn should call handleError again if it fails,
    // which will increment consecutiveFailures and trigger step 2
    try {
      await fn();
    } catch (e) {
      // retryFn should handle its own error via handleError
      // If it doesn't, we catch it silently
    }
  }, []);

  return { error, handleError, clearError, retry };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component: ErrorBanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {object|null} props.error — Error result from useErrorHandler
 * @param {Function}    props.onRetry — Called when user clicks retry
 * @param {Function}    props.onDismiss — Called when user clicks X
 */
export function ErrorBanner({ error, onRetry, onDismiss }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!error) return null;

  const isHebrew = error.language !== 'en';
  const dir = isHebrew ? 'rtl' : 'ltr';

  // Texts
  const texts = isHebrew ? {
    title: 'משהו השתבש',
    subtitle: error.userMessage,
    retry: 'נסה שוב',
    sendReport: error.autoReported ? 'שלח פרטים נוספים' : 'שלח פרטי תקלה',
    sending: 'שולח...',
    sent: 'נשלח בהצלחה! תודה.',
    sentSubtitle: 'צוות הפיתוח יבדוק את הבעיה.',
    autoReported: 'פרטי התקלה נשלחו אוטומטית',
  } : {
    title: 'Something went wrong',
    subtitle: error.userMessage,
    retry: 'Try again',
    sendReport: error.autoReported ? 'Send additional details' : 'Send problem details',
    sending: 'Sending...',
    sent: 'Sent successfully! Thank you.',
    sentSubtitle: 'The development team will look into it.',
    autoReported: 'Error details sent automatically',
  };

  const handleSendReport = async () => {
    setSending(true);
    try {
      const result = await logger.sendErrorReport({
        maxEntries: 20,
        userNote: `Operation: ${error.operation}, Code: ${error.code}`,
        fingerprint: error.fingerprint || null,
      });
      if (result.success) {
        setSent(true);
      }
    } catch (e) {
      // Sending failed — not much we can do
      console.error('Failed to send error report:', e);
    } finally {
      setSending(false);
    }
  };

  // ── Success state (after sending report) ────────────────────────────────

  if (sent) {
    return (
      <div style={{ ...styles.container, ...styles.successContainer }} dir={dir}>
        <div style={styles.content}>
          <div style={styles.icon}>✅</div>
          <div style={styles.textWrap}>
            <div style={styles.title}>{texts.sent}</div>
            <div style={styles.subtitle}>{texts.sentSubtitle}</div>
          </div>
          <button
            onClick={() => { setSent(false); onDismiss?.(); }}
            style={styles.closeBtn}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────

  return (
    <div style={styles.container} dir={dir}>
      <div style={styles.content}>
        <div style={styles.icon}>⚠️</div>
        <div style={styles.textWrap}>
          <div style={styles.title}>{texts.title}</div>
          <div style={styles.subtitle}>{texts.subtitle}</div>
        </div>
        <button
          onClick={() => { setSent(false); onDismiss?.(); }}
          style={styles.closeBtn}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Auto-reported info text */}
      {error.autoReported && (
        <div style={styles.autoReportedText}>
          {texts.autoReported}
        </div>
      )}

      <div style={styles.actions}>
        {/* Always show retry */}
        <button onClick={onRetry} style={styles.retryBtn}>
          {texts.retry}
        </button>

        {/* Show "Send report" / "Send additional details" on 2nd+ failure */}
        {error.showSendReport && logger.isSupabaseReady && (
          <button
            onClick={handleSendReport}
            disabled={sending}
            style={styles.sendBtn}
          >
            {sending ? texts.sending : texts.sendReport}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles (inline — works in any Monday app without CSS setup)
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    background: '#FFF3F3',
    border: '1px solid #E2445C',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '12px',
    fontFamily: 'Figtree, Roboto, sans-serif',
    fontSize: '14px',
    color: '#323338',
    animation: 'fadeIn 0.2s ease-in',
  },
  successContainer: {
    background: '#F0FFF4',
    border: '1px solid #00CA72',
  },
  content: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
  },
  icon: {
    fontSize: '20px',
    lineHeight: '1',
    flexShrink: 0,
    marginTop: '1px',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: 600,
    fontSize: '14px',
    color: '#323338',
    marginBottom: '2px',
  },
  subtitle: {
    fontSize: '13px',
    color: '#676879',
    lineHeight: '1.4',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#676879',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 4px',
    flexShrink: 0,
    lineHeight: '1',
  },
  autoReportedText: {
    fontSize: '12px',
    color: '#676879',
    marginTop: '6px',
    paddingRight: '30px',
    paddingLeft: '30px',
    fontStyle: 'italic',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
    paddingRight: '30px', // Align with text (icon width + gap)
    paddingLeft: '30px',
  },
  retryBtn: {
    background: '#0073EA',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sendBtn: {
    background: 'transparent',
    color: '#0073EA',
    border: '1px solid #0073EA',
    borderRadius: '4px',
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

export default ErrorBanner;
