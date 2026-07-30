-- Supabase Auth migration (ADR-031): link profiles to auth.users.
-- Idempotent — safe to re-run.

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "auth_user_id" UUID;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "auth_linked_at" TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_auth_user_id_key" ON "profiles"("auth_user_id");

-- token_blacklist: confirmed orphaned, zero live code references.
DROP TABLE IF EXISTS "token_blacklist";
