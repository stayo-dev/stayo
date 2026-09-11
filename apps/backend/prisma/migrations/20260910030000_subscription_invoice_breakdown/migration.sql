-- ADR-172 Phase 6.6 — recurring paid extra-bed billing: invoice breakdown.
--
-- Splits `subscription_invoices.amount_paise` (the total charged) into its
-- two components so an invoice can show the plan amount and the extra-bed
-- amount separately, per-bed price included, and reconcile exactly:
--
--   plan_amount_paise + extra_bed_amount_paise + tax_paise = amount_paise
--
-- `extra_bed_unit_price_paise` is a SNAPSHOT of the per-bed price actually
-- used for this invoice, taken at invoice-creation time — a later admin edit
-- to `subscription_plans.extra_bed_price_paise` must never change what an
-- already-issued invoice says it charged. NULL when the invoice has no extra
-- beds (nothing was snapshotted).
--
-- Idempotent, non-destructive. Not applied to any environment by this change
-- — generated only, same as `20260910010000_subscription_extra_beds`.

ALTER TABLE "subscription_invoices"
  ADD COLUMN IF NOT EXISTS "plan_amount_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "extra_bed_unit_price_paise" INTEGER,
  ADD COLUMN IF NOT EXISTS "extra_bed_amount_paise" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows (if any ever exist in an environment this runs
-- against) so historical invoices reconcile too: treat the whole stored
-- amount as the plan portion and 0 as the extra-bed portion, since no
-- pre-Phase-6.6 invoice ever separately priced extra beds. This is the only
-- backfill possible without inventing numbers — an old invoice's true split
-- (if it had one) was never recorded.
UPDATE "subscription_invoices"
  SET "plan_amount_paise" = "amount_paise" - "tax_paise"
  WHERE "plan_amount_paise" = 0 AND "extra_bed_amount_paise" = 0;
