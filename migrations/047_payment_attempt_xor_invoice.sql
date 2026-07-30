-- Migration 047: PaymentAttempt invoice/obligation XOR and FK
-- Safe, idempotent (IF NOT EXISTS guards)

-- 1) Add invoice_id column & relax obligation_id NOT NULL
ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS invoice_id UUID NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='payment_attempts' AND column_name='obligation_id'
  ) THEN
    -- Drop NOT NULL only if currently NOT NULL
    EXECUTE 'ALTER TABLE payment_attempts ALTER COLUMN obligation_id DROP NOT NULL';
  END IF;
END $$;

-- 2) Add FK to owner_invoices
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_invoice_id_fkey'
  ) THEN
    ALTER TABLE payment_attempts
      ADD CONSTRAINT payment_attempts_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES owner_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3) XOR constraint: exactly one of (obligation_id, invoice_id) must be non-null
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_obligation_invoice_xor_check'
  ) THEN
    ALTER TABLE payment_attempts
      ADD CONSTRAINT payment_attempts_obligation_invoice_xor_check
      CHECK (
        (
          (obligation_id IS NOT NULL)::int + (invoice_id IS NOT NULL)::int
        ) = 1
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_invoice ON payment_attempts(invoice_id);
