-- ADR-172 — updated plan capacity model: included beds + paid extra beds.
--
--   FOUNDING     250 included, unlimited extra beds @ ₹10/bed (no ceiling)
--   STARTER       50 included, up to  10 extra beds @ ₹10/bed
--   GROWTH       100 included, up to  25 extra beds @ ₹10/bed
--   PROFESSIONAL 250 included, up to  50 extra beds @ ₹10/bed
--   PORTFOLIO    500 included, extra beds NOT YET OFFERED (max_extra_beds = 0
--                — business decision required, see docs/obsidian/Business-Rules.md)
--
-- `subscription_plans.capacity_max` keeps its existing meaning (the plan's
-- hard ceiling = included_beds + max_extra_beds, or NULL = unlimited) so every
-- existing reader of that column keeps working unchanged. The two new plan
-- columns (`included_beds`, `max_extra_beds`) plus `extra_bed_price_paise`
-- are what the capacity/pricing services now read for the granular
-- included-vs-extra distinction; `capacity_max` itself is not touched by this
-- migration except by the (separate, application-level) plan reseed.
--
-- Idempotent, non-destructive. Column values are backfilled here in SQL too
-- (mirroring `scripts/seed-subscription-plans.ts`) so `prisma db push` alone
-- leaves the catalogue correct even before the seed script is re-run.

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "included_beds" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_extra_beds" INTEGER,
  ADD COLUMN IF NOT EXISTS "extra_bed_price_paise" INTEGER;

ALTER TABLE "owner_subscriptions"
  ADD COLUMN IF NOT EXISTS "extra_beds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "subscription_payments"
  ADD COLUMN IF NOT EXISTS "extra_beds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "subscription_invoices"
  ADD COLUMN IF NOT EXISTS "extra_beds" INTEGER NOT NULL DEFAULT 0;

-- Backfill the catalogue's new columns (safe to re-run — WHERE guards make it
-- a no-op once applied; re-running scripts/seed-subscription-plans.ts after
-- this migration achieves the same result and is the source of truth going
-- forward).
UPDATE "subscription_plans" SET "included_beds" = 250, "max_extra_beds" = NULL, "extra_bed_price_paise" = 1000
  WHERE "code" = 'FOUNDING';
UPDATE "subscription_plans" SET "included_beds" = 50, "max_extra_beds" = 10, "extra_bed_price_paise" = 1000, "capacity_max" = 60
  WHERE "code" = 'STARTER';
UPDATE "subscription_plans" SET "included_beds" = 100, "max_extra_beds" = 25, "extra_bed_price_paise" = 1000, "capacity_max" = 125
  WHERE "code" = 'GROWTH';
UPDATE "subscription_plans" SET "included_beds" = 250, "max_extra_beds" = 50, "extra_bed_price_paise" = 1000, "capacity_max" = 300
  WHERE "code" = 'PROFESSIONAL';
-- Portfolio: base capacity preserved (500), NO extra-bed allowance invented —
-- max_extra_beds = 0 and extra_bed_price_paise stays NULL until the business
-- defines a number. capacity_max is left at its existing value (500).
UPDATE "subscription_plans" SET "included_beds" = 500, "max_extra_beds" = 0, "extra_bed_price_paise" = NULL
  WHERE "code" = 'PORTFOLIO';
