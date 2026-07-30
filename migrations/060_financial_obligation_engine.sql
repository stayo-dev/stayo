-- ============================================================================
-- Migration 060: Financial Obligation Engine
-- ============================================================================
-- Transforms the rent_obligations table into a universal financial obligation
-- system with lifecycle management, event tracking, and audit compliance.
--
-- Changes:
--   1. Extends PaymentStatus enum with DRAFT, CANCELLED
--   2. Adds metadata columns to rent_obligations (description, notes, created_by,
--      cancelled_at/reason, waived_at/reason/by)
--   3. Creates obligation_events table for append-only lifecycle audit trail
--   4. Extends FinancialLedgerReason enum with OBLIGATION_WAIVER, OBLIGATION_CANCELLATION
-- ============================================================================

-- ── 1. Extend PaymentStatus enum ──────────────────────────────────────────────
-- Add DRAFT and CANCELLED to the existing PaymentStatus enum.
-- These support the new obligation lifecycle:
--   DRAFT = created but not yet active (future: approval workflows)
--   CANCELLED = voided obligation (was never valid, generates ledger correction)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'DRAFT'
    AND enumtypid = '"PaymentStatus"'::regtype::oid
  ) THEN
    ALTER TYPE "PaymentStatus" ADD VALUE 'DRAFT';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CANCELLED'
    AND enumtypid = '"PaymentStatus"'::regtype::oid
  ) THEN
    ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';
  END IF;
END $$;

-- ── 2. Extend FinancialLedgerReason enum ──────────────────────────────────────
-- Add OBLIGATION_WAIVER and OBLIGATION_CANCELLATION for financial correction entries.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'OBLIGATION_WAIVER'
    AND enumtypid = '"FinancialLedgerReason"'::regtype::oid
  ) THEN
    ALTER TYPE "FinancialLedgerReason" ADD VALUE 'OBLIGATION_WAIVER';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'OBLIGATION_CANCELLATION'
    AND enumtypid = '"FinancialLedgerReason"'::regtype::oid
  ) THEN
    ALTER TYPE "FinancialLedgerReason" ADD VALUE 'OBLIGATION_CANCELLATION';
  END IF;
END $$;

-- ── 3. Add metadata columns to rent_obligations ──────────────────────────────
-- These columns support generic obligation creation, lifecycle management,
-- and financial audit compliance.

-- Description: Owner-provided description of the obligation (e.g. "Electricity bill for June")
ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Notes: Internal notes (e.g. auditor comments, operational context)
ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Created By: Profile UUID of who created this obligation (owner, admin, system)
ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS created_by UUID;

-- Cancellation metadata
ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS cancelled_by UUID;

-- Waiver metadata (complements the existing WAIVED status)
ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS waived_at TIMESTAMPTZ;

ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS waived_reason TEXT;

ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS waived_by UUID;

-- Waived amount (partial waivers: only the amount actually waived)
ALTER TABLE rent_obligations
  ADD COLUMN IF NOT EXISTS waived_amount DECIMAL(10, 2);


-- ── 4. Create obligation_events table ─────────────────────────────────────────
-- Append-only event log for obligation lifecycle transitions.
-- Every status change, payment application, waiver, or cancellation is recorded
-- as an immutable event, providing a complete audit trail.
--
-- This is NOT the same as system_event_logs — this table is a first-class
-- financial audit artifact with strict schema and FK constraints.

CREATE TABLE IF NOT EXISTS obligation_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id   UUID NOT NULL REFERENCES rent_obligations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  -- Status transition (nullable for non-transition events like AMOUNT_MODIFIED)
  from_status     TEXT,
  to_status       TEXT,
  -- Financial impact
  amount          DECIMAL(10, 2),
  -- Actor
  actor_id        UUID,
  -- Structured event metadata (reason, payment_id, correction details, etc.)
  metadata        JSONB DEFAULT '{}',
  -- Immutable timestamp
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for obligation_events
CREATE INDEX IF NOT EXISTS idx_obligation_events_obligation_id
  ON obligation_events(obligation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_obligation_events_event_type
  ON obligation_events(event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_obligation_events_actor
  ON obligation_events(actor_id, created_at);

-- ── 5. Backfill created_by for existing obligations ────────────────────────────
-- Set created_by = owner_id for all existing obligations that don't have it.
-- This preserves the audit trail for historical obligations.
UPDATE rent_obligations
SET created_by = owner_id
WHERE created_by IS NULL
  AND owner_id IS NOT NULL;

-- ── 6. Backfill waiver metadata for already-WAIVED obligations ─────────────────
-- Existing WAIVED obligations were set via the old waiveObligation flow.
-- We can't recover the exact timestamp/reason, but we mark them as system-migrated.
UPDATE rent_obligations
SET waived_at = updated_at,
    waived_reason = 'Pre-migration waiver (details in system_event_logs)',
    waived_by = owner_id
WHERE status = 'WAIVED'
  AND waived_at IS NULL;


-- ── 7. Add comment documentation ───────────────────────────────────────────────
COMMENT ON TABLE obligation_events IS
  'Append-only audit trail for financial obligation lifecycle events. '
  'Every status change, payment application, waiver, or cancellation is recorded. '
  'Created by migration 060_financial_obligation_engine.sql';

COMMENT ON COLUMN obligation_events.event_type IS
  'Event types: CREATED, STATUS_CHANGED, PAYMENT_APPLIED, PARTIALLY_PAID, '
  'FULLY_PAID, WAIVED, CANCELLED, CORRECTED, AMOUNT_MODIFIED';

COMMENT ON COLUMN rent_obligations.description IS
  'Owner-provided description of the obligation purpose';

COMMENT ON COLUMN rent_obligations.cancelled_at IS
  'Timestamp when the obligation was cancelled (voided)';

COMMENT ON COLUMN rent_obligations.waived_amount IS
  'The outstanding amount that was waived. May be less than the total amount '
  'if payments were already applied before the waiver.';
