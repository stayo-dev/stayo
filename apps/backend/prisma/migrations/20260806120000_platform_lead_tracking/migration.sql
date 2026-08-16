-- Three-step add: the table has existing rows, so a straight
-- "ADD COLUMN NOT NULL UNIQUE" would fail. Add nullable, backfill, constrain.
--
-- Made idempotent 2026-08-15 while resolving a stuck `migrate deploy`: this
-- database already had all three columns, `tracking_token` already NOT NULL
-- and backfilled (0 null rows), and the unique index already present —
-- confirmed live via information_schema before editing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "tracking_token" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "applicant_message" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

UPDATE "platform_leads"
SET "tracking_token" = encode(gen_random_bytes(32), 'hex')
WHERE "tracking_token" IS NULL;

ALTER TABLE "platform_leads" ALTER COLUMN "tracking_token" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "platform_leads_tracking_token_key"
  ON "platform_leads"("tracking_token");
