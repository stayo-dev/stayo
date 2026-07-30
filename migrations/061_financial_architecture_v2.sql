-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 061: Financial Architecture v2
-- 
-- 1. Split PaymentStatus into lifecycle_status + settlement_status
-- 2. Create payment_groups table
-- 3. Drop obligation_events table (replaced by FinancialTimelineService)
-- 4. Remove DRAFT, CANCELLED from PaymentStatus (they become lifecycle states)
--
-- Strategy: Dual-write (Phase A+B). Old `status` column kept for backward
-- compatibility. Queries migrate incrementally (Phase C/D).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. New enums ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE obligation_lifecycle AS ENUM ('ACTIVE', 'WAIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE settlement_state AS ENUM ('UNPAID', 'PARTIAL', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Add new columns to rent_obligations ───────────────────────────────────

ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS lifecycle_status obligation_lifecycle NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS settlement_status settlement_state NOT NULL DEFAULT 'UNPAID';

-- ── 3. Backfill from existing status column ──────────────────────────────────
-- This is safe because every row has exactly one status value.

UPDATE rent_obligations SET
  lifecycle_status = CASE status::text
    WHEN 'WAIVED'    THEN 'WAIVED'::obligation_lifecycle
    WHEN 'CANCELLED' THEN 'CANCELLED'::obligation_lifecycle
    ELSE 'ACTIVE'::obligation_lifecycle
  END,
  settlement_status = CASE status::text
    WHEN 'PAID'    THEN 'PAID'::settlement_state
    WHEN 'PARTIAL' THEN 'PARTIAL'::settlement_state
    WHEN 'WAIVED'  THEN (
      CASE WHEN (
        SELECT COALESCE(SUM(p.amount_paid), 0) 
        FROM payments p 
        WHERE p.obligation_id = rent_obligations.id
      ) > 0 
      THEN 'PARTIAL'::settlement_state 
      ELSE 'UNPAID'::settlement_state 
      END
    )
    ELSE 'UNPAID'::settlement_state
  END;

-- ── 4. Indexes for the new columns ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_obligations_lifecycle 
  ON rent_obligations (lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_obligations_settlement 
  ON rent_obligations (settlement_status);

CREATE INDEX IF NOT EXISTS idx_obligations_lifecycle_settlement 
  ON rent_obligations (lifecycle_status, settlement_status);

CREATE INDEX IF NOT EXISTS idx_obligations_active_unpaid 
  ON rent_obligations (tenant_id, hostel_id, due_date) 
  WHERE lifecycle_status = 'ACTIVE' AND settlement_status IN ('UNPAID', 'PARTIAL');

-- ── 5. Payment Groups table ──────────────────────────────────────────────────
-- Every payment recording generates a Payment Group.
-- Payment Groups → Payments (via payment_group_id FK).
-- Future: Payment Groups → Payment Allocations → Payments (three-level).

CREATE TABLE IF NOT EXISTS payment_groups (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  owner_id              UUID,
  hostel_id             UUID NOT NULL REFERENCES hostels(id),

  -- Financial summary
  total_amount          DECIMAL(10, 2) NOT NULL,
  method                TEXT NOT NULL,
  reference_number      TEXT,

  -- Group lifecycle
  status                TEXT NOT NULL DEFAULT 'COMPLETED',  -- COMPLETED | REVERSED | REFUNDED

  -- Source of the payment
  source                TEXT NOT NULL DEFAULT 'MANUAL',     -- MANUAL | ONLINE | CREDIT_APPLICATION

  -- Settlement result (immutable snapshot)
  settlement_breakdown  JSONB,
  future_credit_amount  DECIMAL(10, 2) DEFAULT 0,

  -- Audit
  recorded_by           UUID,
  recorded_at           TIMESTAMPTZ DEFAULT NOW(),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ
);

-- Indexes for payment_groups
CREATE INDEX IF NOT EXISTS idx_payment_groups_tenant 
  ON payment_groups (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_groups_hostel 
  ON payment_groups (hostel_id);
CREATE INDEX IF NOT EXISTS idx_payment_groups_created 
  ON payment_groups (created_at);
CREATE INDEX IF NOT EXISTS idx_payment_groups_status 
  ON payment_groups (status);

-- ── 6. Add FK from payments to payment_groups ────────────────────────────────
-- payment_group_id column already exists on payments table.
-- We just need to add the constraint.

DO $$ BEGIN
  ALTER TABLE payments
    ADD CONSTRAINT fk_payment_group 
    FOREIGN KEY (payment_group_id) REFERENCES payment_groups(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_group_id 
  ON payments (payment_group_id);

-- ── 7. Drop obligation_events table ──────────────────────────────────────────
-- Replaced by FinancialTimelineService (derived read model).
-- Safe because this table was created in migration 060 and has no production data.

DROP TABLE IF EXISTS obligation_events;

-- ══════════════════════════════════════════════════════════════════════════════
-- NOTE: The old `status` column on rent_obligations is KEPT.
-- It will be dual-written in Phase B and removed in Phase D.
-- Do NOT drop it in this migration.
-- ══════════════════════════════════════════════════════════════════════════════
