-- Migration: advance idempotency, payment_type column, refund_status column
-- All statements are idempotent (IF NOT EXISTS / IF NOT EXISTS index).

-- A. payment_type on payment_attempts (RENT default keeps all existing rows valid)
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'RENT';

-- B. refund_status on tenant_advance_ledger (nullable — only populated on REFUND entries)
ALTER TABLE tenant_advance_ledger ADD COLUMN IF NOT EXISTS refund_status TEXT;

-- C. Partial unique index — idempotency guard for ledger entries linked to a source record.
--    Prevents duplicate CREDIT/DEBIT entries when the same payment_attempt_id is processed twice.
--    NULL reference_id is excluded so manual (non-gateway) entries are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tal_ref_idempotency
  ON tenant_advance_ledger(reference_id, reference_type)
  WHERE reference_id IS NOT NULL;
