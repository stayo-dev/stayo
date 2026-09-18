-- 084_lead_source_tracking.sql
--
-- Adds `source` and `plan_code` to platform_leads so the admin console can
-- see where a lead came from (landing page, pricing section, "Book a demo")
-- and which subscription_plans.code they expressed interest in, instead of
-- every acquisition surface reading identically once a lead lands in the CRM.
-- `plan_code` deliberately has no FK to subscription_plans — a lead is intent,
-- not a real subscription, and must not be blocked by a renamed/retired plan.
--
-- Apply via the Supabase SQL editor or psql. Idempotent. Never
-- `prisma migrate deploy` (see prisma-field-addition notes in docs/obsidian).

ALTER TABLE platform_leads
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS plan_code text;
