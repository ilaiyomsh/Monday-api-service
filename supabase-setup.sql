-- ============================================================================
-- Supabase Setup — Monday.com App Error Reporting (Fresh Install)
-- Run this in your Supabase SQL Editor (one time)
-- ============================================================================

-- ============================================================================
-- TABLE 1: error_events (anonymous, auto-reported — NO PII)
-- Receives automatic error reports when retries are exhausted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS error_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Error identity
  fingerprint TEXT NOT NULL,         -- Hash of operation + code + normalized message
  error_code  TEXT,                  -- e.g. 'ColumnValueException'
  operation   TEXT,                  -- e.g. 'createItem'

  -- Error details (no PII — full technical info auto-reported)
  message     TEXT,                  -- Error message
  level       TEXT DEFAULT 'error',  -- Log level
  request_id  TEXT,                  -- Monday API request_id (for Monday support)
  data        JSONB,                 -- Full error payload (errors array, raw response, etc.)

  -- Context (no PII)
  app_id      TEXT,                  -- e.g. 'team-dynamic'
  app_version TEXT,                  -- e.g. '1.2.3'
  environment TEXT DEFAULT 'production',

  -- Debugging context
  breadcrumbs JSONB                  -- Last N API operations (full breadcrumbs, no user data)
);

CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint  ON error_events (fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_events_timestamp    ON error_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_error_code   ON error_events (error_code);
CREATE INDEX IF NOT EXISTS idx_error_events_environment  ON error_events (environment);
CREATE INDEX IF NOT EXISTS idx_error_events_app_id       ON error_events (app_id);

ALTER TABLE error_events ENABLE ROW LEVEL SECURITY;

-- NO direct INSERT for anon — all inserts go through the RPC function below
-- This prevents abuse: the function validates payload and rate-limits.

-- Authenticated users can read error events (for error dashboard)
CREATE POLICY "Authenticated can read error events"
  ON error_events FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- RPC FUNCTION: insert_error_event (rate-limited, validated)
-- Client calls this via POST /rest/v1/rpc/insert_error_event
-- Prevents flooding: max 1000 events/hour, validates fingerprint format.
-- ============================================================================

CREATE OR REPLACE FUNCTION insert_error_event(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as table owner, bypasses RLS
AS $$
DECLARE
  recent_count int;
  fp text;
BEGIN
  -- Extract and validate fingerprint
  fp := payload->>'fingerprint';
  IF fp IS NULL OR fp !~ '^fp-[a-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid fingerprint format';
  END IF;

  -- Rate limit: max 1000 events per hour (across all clients)
  SELECT COUNT(*) INTO recent_count
  FROM error_events
  WHERE timestamp > NOW() - INTERVAL '1 hour';

  IF recent_count >= 1000 THEN
    RAISE EXCEPTION 'Rate limit exceeded';
  END IF;

  -- Validate field lengths to prevent oversized payloads
  IF length(COALESCE(payload->>'error_code', '')) > 200 THEN
    RAISE EXCEPTION 'error_code too long';
  END IF;
  IF length(COALESCE(payload->>'operation', '')) > 200 THEN
    RAISE EXCEPTION 'operation too long';
  END IF;

  INSERT INTO error_events (fingerprint, error_code, operation, message, level, request_id, data, app_id, app_version, environment, breadcrumbs)
  VALUES (
    fp,
    left(payload->>'error_code', 200),
    left(payload->>'operation', 200),
    left(payload->>'message', 1000),
    left(COALESCE(payload->>'level', 'error'), 20),
    left(payload->>'request_id', 200),
    (payload->'data')::jsonb,
    left(payload->>'app_id', 100),
    left(payload->>'app_version', 50),
    left(payload->>'environment', 50),
    (payload->'breadcrumbs')::jsonb
  );
END;
$$;

-- Allow anon to call the RPC function
GRANT EXECUTE ON FUNCTION insert_error_event(jsonb) TO anon;

-- ============================================================================
-- TABLE 2: error_logs (user-triggered reports — has PII)
-- Receives detailed reports when user clicks "Send problem details".
-- ============================================================================

CREATE TABLE IF NOT EXISTS error_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Log level & message
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,

  -- Monday.com context (PII — only in user-triggered reports)
  user_id     TEXT,
  user_name   TEXT,
  user_email  TEXT,
  account_id  TEXT,
  board_id    TEXT,
  board_url   TEXT,
  instance_id TEXT,
  app_id      TEXT,

  -- Error details
  request_id  TEXT,          -- Monday API request_id (give to Monday support)
  error_code  TEXT,          -- e.g. 'ColumnValueException'
  operation   TEXT,          -- e.g. 'createItem'

  -- Report grouping
  report_id   TEXT,
  user_note   TEXT,

  -- Fingerprint (links to error_events for joining)
  fingerprint TEXT,
  app_version TEXT,
  environment TEXT,
  breadcrumbs JSONB,
  report_type TEXT DEFAULT 'user',  -- 'user' or 'auto'

  -- Full payload
  data        JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp  ON error_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_account    ON error_logs (account_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_report     ON error_logs (report_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_code       ON error_logs (error_code);
CREATE INDEX IF NOT EXISTS idx_error_logs_request_id ON error_logs (request_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_fingerprint ON error_logs (fingerprint);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- ANYONE can INSERT (client-side apps use the anon key)
CREATE POLICY "Anyone can insert error logs"
  ON error_logs FOR INSERT TO anon
  WITH CHECK (true);

-- Authenticated users can read error logs (for error dashboard)
CREATE POLICY "Authenticated can read error logs"
  ON error_logs FOR SELECT TO authenticated USING (true);

-- No UPDATE/DELETE policies = nobody can modify or delete logs

-- ============================================================================
-- VIEWS — Aggregation and Trend Analysis
-- ============================================================================

-- "Issues" view: errors grouped by fingerprint (like Sentry's Issues page)
-- Joins anonymous events with user-triggered reports
CREATE OR REPLACE VIEW error_issues AS
SELECT
  e.fingerprint,
  e.error_code,
  e.operation,
  e.app_id,
  COUNT(*) AS total_occurrences,
  MAX(e.timestamp) AS last_seen,
  MIN(e.timestamp) AS first_seen,
  MAX(e.app_version) AS latest_version,
  (SELECT COUNT(*) FROM error_logs l WHERE l.fingerprint = e.fingerprint) AS detailed_reports
FROM error_events e
GROUP BY e.fingerprint, e.error_code, e.operation, e.app_id
ORDER BY total_occurrences DESC;

-- Hourly error trend (last 7 days)
CREATE OR REPLACE VIEW error_trend_hourly AS
SELECT
  date_trunc('hour', timestamp) AS hour,
  error_code,
  environment,
  COUNT(*) AS count
FROM error_events
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY hour, error_code, environment
ORDER BY hour DESC;

-- Per-account error summary (from user-triggered reports only — has account_id)
CREATE OR REPLACE VIEW error_by_account AS
SELECT
  account_id,
  COUNT(*) AS total_reports,
  COUNT(DISTINCT fingerprint) AS unique_errors,
  MAX(timestamp) AS last_error,
  array_agg(DISTINCT error_code) FILTER (WHERE error_code IS NOT NULL) AS error_codes
FROM error_logs
WHERE timestamp > NOW() - INTERVAL '30 days'
  AND account_id IS NOT NULL
GROUP BY account_id
ORDER BY total_reports DESC;

-- Per-app error summary (last 30 days)
CREATE OR REPLACE VIEW error_by_app AS
WITH combined AS (
  SELECT app_id, fingerprint, error_code, timestamp FROM error_events WHERE app_id IS NOT NULL
  UNION ALL
  SELECT app_id, fingerprint, error_code, timestamp FROM error_logs WHERE app_id IS NOT NULL
)
SELECT
  app_id,
  COUNT(*) AS total_events,
  COUNT(DISTINCT fingerprint) AS unique_errors,
  MAX(timestamp) AS last_error,
  MIN(timestamp) AS first_error,
  array_agg(DISTINCT error_code) FILTER (WHERE error_code IS NOT NULL) AS error_codes
FROM combined
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY app_id
ORDER BY total_events DESC;

-- Daily error trend (last 30 days)
CREATE OR REPLACE VIEW error_trend_daily AS
SELECT
  date_trunc('day', timestamp) AS day,
  error_code,
  environment,
  app_id,
  COUNT(*) AS count
FROM error_events
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY day, error_code, environment, app_id
ORDER BY day DESC;

-- Grant SELECT on all views to authenticated role (for error dashboard)
GRANT SELECT ON error_issues TO authenticated;
GRANT SELECT ON error_trend_hourly TO authenticated;
GRANT SELECT ON error_trend_daily TO authenticated;
GRANT SELECT ON error_by_account TO authenticated;
GRANT SELECT ON error_by_app TO authenticated;

-- ============================================================================
-- USEFUL QUERIES
-- ============================================================================

-- Top errors this week
-- SELECT * FROM error_issues WHERE last_seen > NOW() - INTERVAL '7 days' LIMIT 20;

-- Hourly trend for a specific error
-- SELECT * FROM error_trend_hourly WHERE error_code = 'ColumnValueException';

-- All reports for an account
-- SELECT * FROM error_by_account WHERE account_id = 'your-account-id';

-- Join anonymous event to user reports by fingerprint
-- SELECT e.fingerprint, e.error_code, e.operation, COUNT(e.*) as auto_count,
--        COUNT(l.*) as user_reports
-- FROM error_events e
-- LEFT JOIN error_logs l ON l.fingerprint = e.fingerprint
-- GROUP BY e.fingerprint, e.error_code, e.operation;

-- Drill into a specific report
-- SELECT * FROM error_logs WHERE report_id = 'some-report-id' ORDER BY timestamp;
