-- 014_payment_hardening.sql
-- Adds payment grouping and idempotency for financial-grade payment integrity.

-- Groups multiple Payment rows from a single user action (FIFO allocation)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_payments_group_id
  ON payments(payment_group_id) WHERE payment_group_id IS NOT NULL;

-- Prevents duplicate payments from retries / double-clicks
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key
  ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
