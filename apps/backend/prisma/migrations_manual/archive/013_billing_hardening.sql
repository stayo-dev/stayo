-- 013_billing_hardening.sql
-- Fixes: C2 (NULL unique bypass), C4 (receipt TOCTOU race), H1 (no unique on receipt.payment_id)

-- C2: Partial unique index for obligations where allocation_id IS NULL
-- PostgreSQL treats NULLs as distinct in unique constraints, so LATE_FEE
-- obligations with NULL allocation_id can silently duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "rent_obligations_tenant_month_type_null_alloc"
  ON rent_obligations (tenant_id, rent_month, obligation_type)
  WHERE allocation_id IS NULL;

-- H1: Prevent duplicate receipts for the same payment
-- Without this, concurrent receipt creation can produce duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "receipts_payment_id_unique"
  ON receipts (payment_id);

-- C4: Atomic receipt sequence (replaces find-max + check-exists + insert)
CREATE SEQUENCE IF NOT EXISTS receipt_seq START WITH 1 INCREMENT BY 1;

-- Seed sequence from existing receipts so we don't collide
DO $$
DECLARE
  max_seq INT;
BEGIN
  SELECT COALESCE(MAX(
    CASE
      WHEN receipt_number ~ '-\d{5}$'
      THEN CAST(RIGHT(receipt_number, 5) AS INT)
      ELSE 0
    END
  ), 0) INTO max_seq FROM receipts;
  
  IF max_seq > 0 THEN
    PERFORM setval('receipt_seq', max_seq);
  END IF;
END $$;
