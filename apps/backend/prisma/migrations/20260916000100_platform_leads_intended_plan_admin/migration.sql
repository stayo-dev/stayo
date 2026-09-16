-- Records which admin picked intended_plan_code, so the eventual
-- SUBSCRIPTION_PLAN_CHANGED audit log (fired at owner-signup completion,
-- not at admin action time) attributes to a real actor instead of a
-- generic system placeholder. Idempotent — safe to re-run.

ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "intended_plan_set_by" TEXT;
