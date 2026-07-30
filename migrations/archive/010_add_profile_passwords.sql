-- Migration 010: Add password security to profiles
-- This allows real authentication via email/password.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- For existing profiles, we might want to set a default password or leave it NULL.
-- Since this is a demo, we can set a dummy hash for the main admin if we know the ID,
-- but usually, we'd handle this via a reset flow.

COMMENT ON COLUMN profiles.password_hash IS 'Bcrypt hashed password for system access';
