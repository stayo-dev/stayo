-- ADR-172 — Owner subscription billing, Phase 1 (schema only).
--
-- Supersedes ADR-030's per-hostel `hostel_subscriptions` / `platform_invoices`
-- shape with owner-level `owner_subscriptions`, plus separate `subscription_payments`
-- (money) and `subscription_invoices` (document) entities, and `owner_billing_profiles`.
-- Extends the existing `subscription_plans` catalog with `code` + capacity + paise pricing.
--
-- Money is integer paise. NO GST logic (Stayo is not GST-registered). NO service,
-- capacity enforcement, cron, approval API or UI — those are later phases.
--
-- Idempotent — safe to re-run. NON-DESTRUCTIVE: the deprecated `hostel_subscriptions`
-- and `platform_invoices` tables are left fully intact. A reversible teardown is in
-- the sibling `down.sql` (never run automatically).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "OwnerSubscriptionStatus" AS ENUM
    ('TRIAL', 'PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'PAUSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionPaymentStatus" AS ENUM
    ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionPaymentMethod" AS ENUM
    ('UPI_MANUAL', 'CASH', 'GATEWAY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Extend the existing `subscription_plans` catalog (reused, not replaced)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "code"         TEXT;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "price_paise"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "currency"     TEXT    NOT NULL DEFAULT 'INR';
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "capacity_min" INTEGER;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "capacity_max" INTEGER;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "is_public"    BOOLEAN NOT NULL DEFAULT TRUE;

-- `price_amount` (Decimal rupees) becomes nullable — retained only for the
-- deprecated per-hostel admin routes; ADR-172 code reads `price_paise`.
ALTER TABLE "subscription_plans" ALTER COLUMN "price_amount" DROP NOT NULL;

-- Default the billing cycle so plan inserts need not specify it.
ALTER TABLE "subscription_plans" ALTER COLUMN "billing_cycle" SET DEFAULT 'MONTHLY';

-- Backfill `code` for any pre-existing rows (expected: none), then enforce
-- NOT NULL + UNIQUE. A no-op on an empty table.
UPDATE "subscription_plans"
   SET "code" = UPPER(REGEXP_REPLACE(COALESCE("name", "id"::text), '[^A-Za-z0-9]+', '_', 'g'))
 WHERE "code" IS NULL;

DO $$ BEGIN
  ALTER TABLE "subscription_plans" ALTER COLUMN "code" SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'subscription_plans.code left nullable — pre-existing rows without a code; resolve manually.';
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_code_key" ON "subscription_plans" ("code");

-- ────────────────────────────────────────────────────────────────────────────
-- 3. owner_subscriptions — one row per owner (owner_id UNIQUE)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "owner_subscriptions" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id"              UUID NOT NULL,
  "plan_id"               UUID NOT NULL,
  "status"                "OwnerSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  "trial_ends_at"         TIMESTAMPTZ(6),
  "current_period_start"  DATE,
  "current_period_end"    DATE,
  "next_renewal_at"       DATE,
  "started_at"            TIMESTAMPTZ(6),
  "cancelled_at"          TIMESTAMPTZ(6),
  "admin_override_until"  TIMESTAMPTZ(6),
  "admin_override_reason" TEXT,
  "admin_override_by"     UUID,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ(6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "owner_subscriptions_owner_id_key"       ON "owner_subscriptions" ("owner_id");
CREATE INDEX        IF NOT EXISTS "owner_subscriptions_status_idx"          ON "owner_subscriptions" ("status");
CREATE INDEX        IF NOT EXISTS "owner_subscriptions_plan_id_idx"         ON "owner_subscriptions" ("plan_id");
CREATE INDEX        IF NOT EXISTS "owner_subscriptions_current_period_end_idx" ON "owner_subscriptions" ("current_period_end");
CREATE INDEX        IF NOT EXISTS "owner_subscriptions_next_renewal_at_idx" ON "owner_subscriptions" ("next_renewal_at");

DO $$ BEGIN
  ALTER TABLE "owner_subscriptions"
    ADD CONSTRAINT "owner_subscriptions_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "owner_subscriptions"
    ADD CONSTRAINT "owner_subscriptions_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. subscription_payments — money in (separate from tenant-rent payments)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "subscription_payments" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id"              UUID NOT NULL,
  "subscription_id"       UUID NOT NULL,
  "plan_id"               UUID NOT NULL,
  "amount_paise"          INTEGER NOT NULL,
  "currency"              TEXT NOT NULL DEFAULT 'INR',
  "payment_method"        "SubscriptionPaymentMethod" NOT NULL,
  "transaction_reference" TEXT,
  "proof_file"            TEXT,
  "status"                "SubscriptionPaymentStatus" NOT NULL DEFAULT 'SUBMITTED',
  "rejection_reason"      TEXT,
  "submitted_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "reviewed_at"           TIMESTAMPTZ(6),
  "reviewed_by"           UUID,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "subscription_payments_owner_id_created_at_idx"       ON "subscription_payments" ("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "subscription_payments_subscription_id_idx"           ON "subscription_payments" ("subscription_id");
CREATE INDEX IF NOT EXISTS "subscription_payments_status_submitted_at_idx"       ON "subscription_payments" ("status", "submitted_at");
CREATE INDEX IF NOT EXISTS "subscription_payments_transaction_reference_idx"     ON "subscription_payments" ("transaction_reference");

DO $$ BEGIN
  ALTER TABLE "subscription_payments"
    ADD CONSTRAINT "subscription_payments_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "subscription_payments"
    ADD CONSTRAINT "subscription_payments_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "owner_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "subscription_payments"
    ADD CONSTRAINT "subscription_payments_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. subscription_invoices — the financial document (one per approved payment)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "subscription_invoices" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id"              UUID NOT NULL,
  "subscription_id"       UUID NOT NULL,
  "payment_id"            UUID NOT NULL,
  "invoice_number"        TEXT NOT NULL,
  "billing_period_start"  DATE NOT NULL,
  "billing_period_end"    DATE NOT NULL,
  "amount_paise"          INTEGER NOT NULL,
  "tax_paise"             INTEGER NOT NULL DEFAULT 0,
  "currency"              TEXT NOT NULL DEFAULT 'INR',
  "payment_method"        "SubscriptionPaymentMethod" NOT NULL,
  "transaction_reference" TEXT,
  "document_url"          TEXT,
  "notes"                 TEXT,
  "issued_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ(6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_payment_id_key"        ON "subscription_invoices" ("payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_invoice_number_key"    ON "subscription_invoices" ("invoice_number");
CREATE INDEX        IF NOT EXISTS "subscription_invoices_owner_id_issued_at_idx" ON "subscription_invoices" ("owner_id", "issued_at" DESC);
CREATE INDEX        IF NOT EXISTS "subscription_invoices_subscription_id_idx"    ON "subscription_invoices" ("subscription_id");

DO $$ BEGIN
  ALTER TABLE "subscription_invoices"
    ADD CONSTRAINT "subscription_invoices_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "subscription_invoices"
    ADD CONSTRAINT "subscription_invoices_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "owner_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "subscription_invoices"
    ADD CONSTRAINT "subscription_invoices_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. owner_billing_profiles — owner billing contact (1:1 with profile)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "owner_billing_profiles" (
  "owner_id"        UUID PRIMARY KEY,
  "billing_name"    TEXT,
  "billing_email"   TEXT,
  "billing_phone"   TEXT,
  "billing_address" TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ(6)
);

DO $$ BEGIN
  ALTER TABLE "owner_billing_profiles"
    ADD CONSTRAINT "owner_billing_profiles_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Seed the plan catalog (ADR-172).
--    Keep in sync with scripts/seed-subscription-plans.ts (the canonical seed).
--    ON CONFLICT keeps a manual price edit from being reverted by a re-run of
--    this migration — only inserts missing plans.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO "subscription_plans"
  ("code", "name", "price_paise", "currency", "billing_cycle", "capacity_min", "capacity_max", "is_public", "is_active", "price_amount")
VALUES
  -- FOUNDING: first-10-owners launch offer, unlimited tenant capacity (capacity_max NULL).
  ('FOUNDING',     'Founding',     200000, 'INR', 'MONTHLY',   1, NULL, FALSE, TRUE, 2000.00),
  ('STARTER',      'Starter',      149900, 'INR', 'MONTHLY',   1,  50, TRUE,  TRUE, 1499.00),
  ('GROWTH',       'Growth',       249900, 'INR', 'MONTHLY',  51, 100, TRUE,  TRUE, 2499.00),
  ('PROFESSIONAL', 'Professional', 449900, 'INR', 'MONTHLY', 101, 250, TRUE,  TRUE, 4499.00),
  ('PORTFOLIO',    'Portfolio',    799900, 'INR', 'MONTHLY', 251, 500, TRUE,  TRUE, 7999.00)
ON CONFLICT ("code") DO NOTHING;
