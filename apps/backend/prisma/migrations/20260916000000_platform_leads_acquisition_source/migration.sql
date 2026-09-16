-- Admin -> Direct Owner Onboarding (field/direct marketing channel).
-- Tags how a lead entered the funnel, and lets an admin pre-select a plan
-- before the owner account exists (subscriptions require a real owner_id,
-- which only exists after signup completes). Idempotent — safe to re-run.

DO $$ BEGIN
  CREATE TYPE "PlatformLeadAcquisitionSource" AS ENUM ('WEBSITE', 'DIRECT_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "platform_leads"
  ADD COLUMN IF NOT EXISTS "acquisition_source" "PlatformLeadAcquisitionSource" NOT NULL DEFAULT 'WEBSITE';

ALTER TABLE "platform_leads"
  ADD COLUMN IF NOT EXISTS "intended_plan_code" TEXT;
