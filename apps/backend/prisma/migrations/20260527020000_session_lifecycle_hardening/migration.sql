ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "session_id" UUID,
  ADD COLUMN IF NOT EXISTS "absolute_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "rotated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "device_info" TEXT,
  ADD COLUMN IF NOT EXISTS "ip_address" TEXT;

CREATE INDEX IF NOT EXISTS "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_last_activity_at_idx" ON "refresh_tokens"("last_activity_at");
CREATE INDEX IF NOT EXISTS "refresh_tokens_revoked_at_idx" ON "refresh_tokens"("revoked_at");
