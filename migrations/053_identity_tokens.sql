-- Migration 053: Single-use identity tokens for high-risk financial actions

CREATE TABLE IF NOT EXISTS identity_tokens (
  jti        TEXT        PRIMARY KEY,
  user_id    UUID        NOT NULL,
  purpose    TEXT        NOT NULL,
  action     TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT false,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_tokens_user_used_expires
  ON identity_tokens (user_id, used, expires_at);

-- Auto-prune tokens older than 1 hour (both used and expired ones are worthless)
CREATE OR REPLACE FUNCTION prune_identity_tokens() RETURNS void LANGUAGE sql AS $$
  DELETE FROM identity_tokens WHERE expires_at < NOW() - INTERVAL '1 hour';
$$;
