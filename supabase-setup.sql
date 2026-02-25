-- ============================================================================
-- Supabase Setup — Monday.com App Error Reporting
-- Run this in your Supabase SQL Editor (one time)
-- ============================================================================

-- 1. Create error_logs table
CREATE TABLE IF NOT EXISTS error_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Log level & message
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,

  -- Monday.com context
  user_id     TEXT,
  account_id  TEXT,
  board_id    TEXT,
  instance_id TEXT,
  app_id      TEXT,

  -- Error details
  request_id  TEXT,          -- Monday API request_id (give to Monday support)
  error_code  TEXT,          -- e.g. 'ColumnValueException'
  operation   TEXT,          -- e.g. 'createItem'

  -- Report grouping (all rows from one "Send problem details" click share a report_id)
  report_id   TEXT,
  user_note   TEXT,          -- What the user / operation context was

  -- Full payload
  data        JSONB
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp  ON error_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_account    ON error_logs (account_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_report     ON error_logs (report_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_code       ON error_logs (error_code);
CREATE INDEX IF NOT EXISTS idx_error_logs_request_id ON error_logs (request_id);

-- 3. Enable Row Level Security
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- 4. ANYONE can INSERT (client-side apps use the anon key)
CREATE POLICY "Anyone can insert error logs"
  ON error_logs FOR INSERT TO anon
  WITH CHECK (true);

-- 5. ONLY YOU can SELECT
-- Replace the UUID below with your Supabase user UUID.
-- Find it: Supabase dashboard → Authentication → Users → copy your ID
CREATE POLICY "Only admin can read error logs"
  ON error_logs FOR SELECT TO authenticated
  USING (auth.uid() = 'PUT-YOUR-SUPABASE-USER-UUID-HERE');

-- No UPDATE/DELETE policies = nobody can modify or delete logs

-- ============================================================================
-- USEFUL QUERIES
-- ============================================================================

-- All reports in the last 24 hours, grouped
-- SELECT report_id, MIN(timestamp) as reported_at, account_id, user_id,
--        array_agg(DISTINCT error_code) as error_codes, COUNT(*) as entries
-- FROM error_logs
-- WHERE timestamp > NOW() - INTERVAL '24 hours' AND report_id IS NOT NULL
-- GROUP BY report_id, account_id, user_id
-- ORDER BY reported_at DESC;

-- Drill into a specific report
-- SELECT * FROM error_logs WHERE report_id = 'some-report-id' ORDER BY timestamp;

-- Most common errors across all accounts
-- SELECT error_code, COUNT(*) FROM error_logs GROUP BY error_code ORDER BY count DESC;
