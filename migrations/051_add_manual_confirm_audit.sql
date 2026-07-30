-- Migration 051: Manual confirmation audit trail + rate-limit action log

-- Audit fields on payment_attempts
ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS manual_confirmed_by  UUID,
  ADD COLUMN IF NOT EXISTS manual_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_confirm_ip    TEXT;

-- Action log for DB-based rate limiting
CREATE TABLE IF NOT EXISTS action_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID        NOT NULL,
  action     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_logs_owner_action_created
  ON action_logs (owner_id, action, created_at DESC);

-- Auto-prune rows older than 1 hour to keep the table lean
-- (rate-limit window is 10 s; 1 h retention is more than enough)
CREATE OR REPLACE FUNCTION prune_action_logs() RETURNS void LANGUAGE sql AS $$
  DELETE FROM action_logs WHERE created_at < NOW() - INTERVAL '1 hour';
$$;
