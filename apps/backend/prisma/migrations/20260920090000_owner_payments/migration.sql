-- Generic Owner Payments — one-off amounts Stayo collects from an owner that
-- are NOT a subscription payment (tenant onboarding cost, custom setup work,
-- ad-hoc support, etc.).
--
-- Deliberately NOT `subscription_payments`: that model is tightly coupled to
-- a plan_id/subscription_id and the admin-review/plan-approval lifecycle
-- (subscription-payment-service.ts). `owner_payments` / `owner_invoices` is a
-- structurally-identical sibling (payment → 1:1 invoice, same PDF/email/
-- ImageKit/activity_logs infrastructure reused) with zero subscription/plan
-- coupling, so recording or voiding one can never touch an owner's
-- owner_subscriptions row.
--
-- Money is integer paise. Idempotent — safe to re-run. NON-DESTRUCTIVE.
-- Applied by hand via psql or the Supabase SQL editor, same as every other
-- migration in this project (`prisma migrate deploy` is unusable here — see
-- 20260916120000_guardian_verification_policy/migration.sql).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "OwnerPaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OwnerPaymentStatus" AS ENUM ('RECORDED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. owner_payments
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "owner_payments" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id"              UUID NOT NULL,
  "amount_paise"          INTEGER NOT NULL,
  "currency"              TEXT NOT NULL DEFAULT 'INR',
  "payment_method"        "OwnerPaymentMethod" NOT NULL,
  "description"           TEXT NOT NULL,
  "transaction_reference" TEXT,
  "proof_file"            TEXT,
  "notes"                 TEXT,
  "status"                "OwnerPaymentStatus" NOT NULL DEFAULT 'RECORDED',
  "idempotency_key"       TEXT,
  "created_by"            UUID NOT NULL,
  "voided_at"             TIMESTAMPTZ(6),
  "voided_by"             UUID,
  "void_reason"           TEXT,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ(6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "owner_payments_idempotency_key_key" ON "owner_payments" ("idempotency_key");
CREATE INDEX        IF NOT EXISTS "owner_payments_owner_id_created_at_idx" ON "owner_payments" ("owner_id", "created_at" DESC);
CREATE INDEX        IF NOT EXISTS "owner_payments_status_idx" ON "owner_payments" ("status");

DO $$ BEGIN
  ALTER TABLE "owner_payments"
    ADD CONSTRAINT "owner_payments_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. owner_invoices — one per payment (payment_id UNIQUE)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "owner_invoices" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id"              UUID NOT NULL,
  "payment_id"            UUID NOT NULL,
  "invoice_number"        TEXT NOT NULL,
  "description"           TEXT NOT NULL,
  "amount_paise"          INTEGER NOT NULL,
  "tax_paise"             INTEGER NOT NULL DEFAULT 0,
  "currency"              TEXT NOT NULL DEFAULT 'INR',
  "payment_method"        "OwnerPaymentMethod" NOT NULL,
  "transaction_reference" TEXT,
  "document_url"          TEXT,
  "emailed_at"            TIMESTAMPTZ(6),
  "email_failed_at"       TIMESTAMPTZ(6),
  "issued_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ(6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "owner_invoices_payment_id_key" ON "owner_invoices" ("payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "owner_invoices_invoice_number_key" ON "owner_invoices" ("invoice_number");
CREATE INDEX        IF NOT EXISTS "owner_invoices_owner_id_issued_at_idx" ON "owner_invoices" ("owner_id", "issued_at" DESC);

DO $$ BEGIN
  ALTER TABLE "owner_invoices"
    ADD CONSTRAINT "owner_invoices_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "owner_invoices"
    ADD CONSTRAINT "owner_invoices_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "owner_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — same shape as 20260910040000_subscription_billing_rls: read-only,
--    own-rows-or-admin. No authenticated-role write policy — every write in
--    this domain goes through the backend's RLS-bypassing service connection.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "owner_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "owner_invoices" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_payments_select_own_or_admin" ON "owner_payments";
CREATE POLICY "owner_payments_select_own_or_admin" ON "owner_payments"
  FOR SELECT
  USING (
    owner_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'ADMIN')
  );

DROP POLICY IF EXISTS "owner_invoices_select_own_or_admin" ON "owner_invoices";
CREATE POLICY "owner_invoices_select_own_or_admin" ON "owner_invoices"
  FOR SELECT
  USING (
    owner_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'ADMIN')
  );
