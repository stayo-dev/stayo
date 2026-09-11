-- Reverts 20260910010000_subscription_extra_beds. Non-destructive to any
-- other data; only drops the columns this migration added.

ALTER TABLE "subscription_invoices" DROP COLUMN IF EXISTS "extra_beds";
ALTER TABLE "subscription_payments" DROP COLUMN IF EXISTS "extra_beds";
ALTER TABLE "owner_subscriptions" DROP COLUMN IF EXISTS "extra_beds";
ALTER TABLE "subscription_plans"
  DROP COLUMN IF EXISTS "extra_bed_price_paise",
  DROP COLUMN IF EXISTS "max_extra_beds",
  DROP COLUMN IF EXISTS "included_beds";
