-- Migration: tenant_overflow_billing
-- Adds overflow billing infrastructure aligned with schema.prisma changes.

-- ── 1. Overflow config columns on plans ──────────────────────────────────────

ALTER TABLE "public"."plans"
  ADD COLUMN IF NOT EXISTS "overflow_enabled"                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "overflow_price_per_tenant_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overflow_hard_cap"              INTEGER NOT NULL DEFAULT 0;

-- Single-owner architecture: subscription plan tiers are not active.
-- Keep overflow billing columns available for schema compatibility, but do not
-- configure plan-specific behavior here.

-- ── 2. line_items on owner_invoices ──────────────────────────────────────────

ALTER TABLE "public"."owner_invoices"
  ADD COLUMN IF NOT EXISTS "line_items" JSONB;

-- ── 3. owner_usage_snapshots table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."owner_usage_snapshots" (
  "id"                    UUID        NOT NULL DEFAULT gen_random_uuid(),
  "owner_id"              UUID        NOT NULL,
  "billing_month"         DATE        NOT NULL,
  "plan_id"               TEXT        NOT NULL,
  "active_tenant_count"   INTEGER     NOT NULL DEFAULT 0,
  "included_limit"        INTEGER     NOT NULL DEFAULT 0,
  "overflow_tenant_count" INTEGER     NOT NULL DEFAULT 0,
  "overflow_amount_paise" INTEGER     NOT NULL DEFAULT 0,
  "peak_tenant_count"     INTEGER     NOT NULL DEFAULT 0,
  "snapshot_taken_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "owner_usage_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_usage_snapshots_owner_id_billing_month_key" UNIQUE ("owner_id", "billing_month")
);

CREATE INDEX IF NOT EXISTS "idx_ous_owner_id"      ON "public"."owner_usage_snapshots" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_ous_billing_month"  ON "public"."owner_usage_snapshots" ("billing_month");

-- ── 4. overflow_ledger table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."overflow_ledger" (
  "id"                              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "owner_id"                        UUID        NOT NULL,
  "billing_month"                   DATE        NOT NULL,
  "plan_id"                         TEXT        NOT NULL,
  "active_tenant_count"             INTEGER     NOT NULL,
  "included_limit"                  INTEGER     NOT NULL,
  "overflow_count"                  INTEGER     NOT NULL DEFAULT 0,
  "overflow_price_per_tenant_paise" INTEGER     NOT NULL DEFAULT 0,
  "overflow_amount_paise"           INTEGER     NOT NULL DEFAULT 0,
  "invoice_id"                      UUID,
  "status"                          TEXT        NOT NULL DEFAULT 'PENDING',
  "idempotency_key"                 TEXT        NOT NULL,
  "created_at"                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at"                    TIMESTAMPTZ,

  CONSTRAINT "overflow_ledger_pkey"                PRIMARY KEY ("id"),
  CONSTRAINT "overflow_ledger_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "overflow_ledger_owner_id_billing_month_key" UNIQUE ("owner_id", "billing_month"),
  CONSTRAINT "overflow_ledger_status_check" CHECK ("status" IN ('PENDING', 'INVOICED', 'WAIVED', 'ZERO')),
  CONSTRAINT "overflow_ledger_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "public"."owner_invoices"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_ol_owner_id"      ON "public"."overflow_ledger" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_ol_billing_month"  ON "public"."overflow_ledger" ("billing_month");
CREATE INDEX IF NOT EXISTS "idx_ol_status"         ON "public"."overflow_ledger" ("status");
