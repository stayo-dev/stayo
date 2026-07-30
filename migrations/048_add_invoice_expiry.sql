-- Migration 048: Add expires_at to owner_invoices
-- Idempotent, safe for production

ALTER TABLE owner_invoices
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

-- Backfill existing invoices: expires_at = due_date + 30 days
UPDATE owner_invoices
SET expires_at = (due_date + INTERVAL '30 days')::timestamptz
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_owner_invoices_expires ON owner_invoices(expires_at) WHERE status = 'PENDING';

COMMENT ON COLUMN owner_invoices.expires_at IS 'Invoice payment window expiry. After this time, payment will be rejected.';
