-- ============================================================================
-- Supabase Migration — Add Production Error Handling Pipeline
-- Run this if you already have the error_logs table from the previous setup.
-- ============================================================================

-- ============================================================================
-- 1. NEW TABLE: error_events (anonymous, auto-reported — NO PII)
-- ============================================================================

CREATE TABLE IF NOT EXISTS error_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  fingerprint TEXT NOT NULL,
  error_code  TEXT,
  operation   TEXT,
  message     TEXT,
  level       TEXT DEFAULT 'error',
  request_id  TEXT,
  data        JSONB,
  app_id      TEXT,
  app_version TEXT,
  environment TEXT DEFAULT 'production',
  breadcrumbs JSONB
);

CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint  ON error_events (fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_events_timestamp    ON error_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_error_code   ON error_events (error_code);
CREATE INDEX IF NOT EXISTS idx_error_events_environment  ON error_events (environment);
CREATE INDEX IF NOT EXISTS idx_error_events_app_id       ON error_events (app_id);

ALTER TABLE error_events ENABLE ROW LEVEL SECURITY;

-- NO direct INSERT for anon — all inserts go through RPC function

-- Authenticated users can read error events (for error dashboard)
CREATE POLICY "Authenticated can read error events"
  ON error_events FOR SELECT TO authenticated USING (true);

-- RPC function: rate-limited, validated insert (includes app_id)
CREATE OR REPLACE FUNCTION insert_error_event(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  recent_count int;
  fp text;
BEGIN
  fp := payload->>'fingerprint';
  IF fp IS NULL OR fp !~ '^fp-[a-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid fingerprint format';
  END IF;

  SELECT COUNT(*) INTO recent_count
  FROM error_events
  WHERE timestamp > NOW() - INTERVAL '1 hour';

  IF recent_count >= 1000 THEN
    RAISE EXCEPTION 'Rate limit exceeded';
  END IF;

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

GRANT EXECUTE ON FUNCTION insert_error_event(jsonb) TO anon;

-- ============================================================================
-- 2. ALTER existing error_logs table — add new columns
-- ============================================================================

ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS fingerprint  TEXT;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS app_version  TEXT;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS environment  TEXT;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS breadcrumbs  JSONB;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS report_type  TEXT DEFAULT 'user';

-- User identity & board URL (added for richer error reports)
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS user_name    TEXT;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS user_email   TEXT;
ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS board_url    TEXT;

CREATE INDEX IF NOT EXISTS idx_error_logs_fingerprint ON error_logs (fingerprint);

-- ============================================================================
-- 3. ADD new columns to error_events (if table already existed before this migration)
-- ============================================================================

ALTER TABLE error_events ADD COLUMN IF NOT EXISTS app_id     TEXT;
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS message    TEXT;
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS level      TEXT DEFAULT 'error';
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS data       JSONB;
CREATE INDEX IF NOT EXISTS idx_error_events_app_id ON error_events (app_id);

-- ============================================================================
-- 4. RLS POLICIES — Allow authenticated users to read (for error dashboard)
-- ============================================================================

-- error_logs: authenticated can read
CREATE POLICY "Authenticated can read error logs"
  ON error_logs FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- 5. VIEWS — Aggregation and Trend Analysis
-- ============================================================================

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
