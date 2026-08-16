-- Qualification answers captured by the conversational lead-capture flow.
-- Purely additive and nullable: every existing row predates the questions, so
-- there is nothing to backfill and no constraint to apply.
--
-- Made idempotent 2026-08-15 while resolving a stuck `migrate deploy`: this
-- database already had both columns.

ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "pain_point" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "current_tooling" TEXT;
