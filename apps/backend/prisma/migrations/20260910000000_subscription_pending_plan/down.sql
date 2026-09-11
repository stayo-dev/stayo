-- Reversible teardown for 20260910000000_subscription_pending_plan.
ALTER TABLE "owner_subscriptions" DROP CONSTRAINT IF EXISTS "owner_subscriptions_pending_plan_id_fkey";
DROP INDEX IF EXISTS "owner_subscriptions_pending_plan_id_idx";
ALTER TABLE "owner_subscriptions" DROP COLUMN IF EXISTS "pending_plan_id";
