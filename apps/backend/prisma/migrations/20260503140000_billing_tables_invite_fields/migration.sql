-- =============================================================
-- Migration: billing tables + tenant invite fields
-- All statements are idempotent (IF NOT EXISTS / DO NOTHING).
-- =============================================================

-- ── 1. plans table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  price_paise   INT  NOT NULL,
  tenant_limit  INT,              -- NULL = unlimited
  hostel_limit  INT,              -- NULL = unlimited
  features      JSONB NOT NULL DEFAULT '[]',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  display_order INT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single-owner architecture: do not seed subscription tiers.
-- The compatibility table is decommissioned by a later migration.

-- ── 2. owner_subscriptions table ─────────────────────────────
CREATE TABLE IF NOT EXISTS owner_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id    UUID NOT NULL REFERENCES plans(id),
  status     TEXT NOT NULL DEFAULT 'FREE',
  start_date DATE NOT NULL,
  end_date   DATE,
  auto_renew BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_owner_sub_owner  ON owner_subscriptions(owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_sub_status ON owner_subscriptions(status);

-- ── 3. owner_invoices table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES owner_subscriptions(id) ON DELETE SET NULL,
  plan_id         UUID REFERENCES plans(id) ON DELETE SET NULL,
  invoice_number  TEXT UNIQUE,
  amount_paise    INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  billing_month   DATE,
  due_date        DATE NOT NULL,
  expires_at      TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_inv_owner_created ON owner_invoices(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owner_inv_status        ON owner_invoices(status);

-- ── 4. Tenant: advance_deposit + maintenance_charge ──────────
-- advance_deposit:    the deposit amount required at move-in (₹0 = none)
-- maintenance_charge: monthly maintenance fee (₹0 = none)
-- Both default to 0 so existing tenants are unaffected.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS advance_deposit    NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS maintenance_charge NUMERIC(10,2) NOT NULL DEFAULT 0;

-- ── 5. Register in _prisma_migrations ────────────────────────
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260503140000_billing_tables_invite_fields', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260503140000_billing_tables_invite_fields'
);
