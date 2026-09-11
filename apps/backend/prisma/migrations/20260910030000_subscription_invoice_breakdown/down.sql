-- Reverts 20260910030000_subscription_invoice_breakdown. Non-destructive to
-- any other data; only drops the columns this migration added.

ALTER TABLE "subscription_invoices"
  DROP COLUMN IF EXISTS "extra_bed_amount_paise",
  DROP COLUMN IF EXISTS "extra_bed_unit_price_paise",
  DROP COLUMN IF EXISTS "plan_amount_paise";
