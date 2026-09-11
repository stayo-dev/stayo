-- Reversible teardown for 20260909000000_owner_subscription_billing_phase1 (ADR-172).
--
-- NEVER run automatically. Run only to roll Phase 1 back on an environment where
-- the owner-subscription system has NOT yet been used. It:
--   * drops the four NEW tables and the three NEW enums
--   * restores `subscription_plans` to its pre-ADR-172 shape (drops the added
--     columns, re-adds NOT NULL on `price_amount`)
--   * leaves the DEPRECATED `hostel_subscriptions` / `platform_invoices` tables
--     completely untouched (this migration never modified them)
--
-- SAFETY: this DROPs `owner_subscriptions`, `subscription_payments`,
-- `subscription_invoices`, `owner_billing_profiles` and every row in them. Do
-- not run if any real subscription/payment/invoice data exists — export first.

DROP TABLE IF EXISTS "subscription_invoices";
DROP TABLE IF EXISTS "subscription_payments";
DROP TABLE IF EXISTS "owner_billing_profiles";
DROP TABLE IF EXISTS "owner_subscriptions";

DROP TYPE IF EXISTS "SubscriptionPaymentMethod";
DROP TYPE IF EXISTS "SubscriptionPaymentStatus";
DROP TYPE IF EXISTS "OwnerSubscriptionStatus";

-- Restore subscription_plans to its ADR-030 shape.
DELETE FROM "subscription_plans"
 WHERE "code" IN ('FOUNDING', 'STARTER', 'GROWTH', 'PROFESSIONAL', 'PORTFOLIO');

DROP INDEX IF EXISTS "subscription_plans_code_key";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "code";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "price_paise";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "capacity_min";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "capacity_max";
ALTER TABLE "subscription_plans" DROP COLUMN IF EXISTS "is_public";
ALTER TABLE "subscription_plans" ALTER COLUMN "billing_cycle" DROP DEFAULT;

-- Only re-add NOT NULL if no NULLs remain (a plan created after the migration
-- may legitimately have a null price_amount).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "subscription_plans" WHERE "price_amount" IS NULL) THEN
    ALTER TABLE "subscription_plans" ALTER COLUMN "price_amount" SET NOT NULL;
  ELSE
    RAISE NOTICE 'subscription_plans.price_amount left nullable — NULL values present.';
  END IF;
END $$;
