-- Migration: Advance Ledger + Tenant DOB
-- Adds tenant_advance_ledger table, AdvanceLedgerType/AdvanceLedgerReason enums,
-- and date_of_birth column on tenants.
-- Safe to run multiple times: all DDL is guarded.

-- Enums
DO $$ BEGIN
  CREATE TYPE "AdvanceLedgerType" AS ENUM ('CREDIT', 'DEBIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdvanceLedgerReason" AS ENUM ('DEPOSIT', 'TOPUP', 'ADJUSTMENT', 'DEDUCTION', 'REFUND', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- date_of_birth on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- TenantAdvanceLedger table
CREATE TABLE IF NOT EXISTS tenant_advance_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  owner_id       UUID NOT NULL,
  type           "AdvanceLedgerType" NOT NULL,
  reason         "AdvanceLedgerReason" NOT NULL,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  balance_after  NUMERIC(10,2) NOT NULL CHECK (balance_after >= 0),
  notes          TEXT,
  reference_id   UUID,
  reference_type TEXT,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tal_tenant_id    ON tenant_advance_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tal_owner_id     ON tenant_advance_ledger(owner_id);
CREATE INDEX IF NOT EXISTS idx_tal_tenant_ts    ON tenant_advance_ledger(tenant_id, created_at);
