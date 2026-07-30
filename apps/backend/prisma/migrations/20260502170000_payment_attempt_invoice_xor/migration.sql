-- Ensure payment_attempts supports invoice-backed SaaS billing attempts
ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS invoice_id UUID;

ALTER TABLE payment_attempts
  ALTER COLUMN obligation_id DROP NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.owner_invoices') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_invoice_id_fkey'
    )
  THEN
    ALTER TABLE payment_attempts
      ADD CONSTRAINT payment_attempts_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES owner_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Historical note:
-- A strict obligation/invoice XOR check is incompatible with current payment
-- architecture because ADVANCE / future-rent-credit attempts can legitimately
-- have neither obligation_id nor invoice_id. The later
-- add_payment_attempt_obligations migration removes this constraint too.
ALTER TABLE payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_obligation_invoice_xor_check;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice_id
  ON payment_attempts(invoice_id);
