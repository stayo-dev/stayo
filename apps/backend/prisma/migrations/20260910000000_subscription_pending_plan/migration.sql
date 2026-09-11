-- ADR-172 — Phase 2: a pending DOWNGRADE plan on owner_subscriptions.
--
-- Set when an approved payment selects a cheaper plan. The current plan_id
-- stays effective until the period ends; a renewal then promotes
-- pending_plan_id to plan_id. Upgrades apply immediately and never use this.
--
-- Idempotent, non-destructive.

ALTER TABLE "owner_subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_id" UUID;

CREATE INDEX IF NOT EXISTS "owner_subscriptions_pending_plan_id_idx"
  ON "owner_subscriptions" ("pending_plan_id");

DO $$ BEGIN
  ALTER TABLE "owner_subscriptions"
    ADD CONSTRAINT "owner_subscriptions_pending_plan_id_fkey"
    FOREIGN KEY ("pending_plan_id") REFERENCES "subscription_plans"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
