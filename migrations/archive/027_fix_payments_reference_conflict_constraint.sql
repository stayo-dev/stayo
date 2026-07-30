-- Migration 027: Fix payments.reference_number conflict target for ON CONFLICT
--
-- Root cause:
-- Some DB paths use INSERT ... ON CONFLICT for payments.reference_number.
-- The previous schema created only a PARTIAL unique index:
--   CREATE UNIQUE INDEX ... ON payments(reference_number) WHERE reference_number IS NOT NULL;
-- That index is not a full-table unique constraint target and can cause:
--   42P10: no unique or exclusion constraint matching the ON CONFLICT specification
--
-- Fix:
-- 1) Drop the partial unique index.
-- 2) Add a proper UNIQUE CONSTRAINT on payments(reference_number).
--
-- Note: PostgreSQL UNIQUE constraints allow multiple NULLs, so this preserves
-- expected behavior while making ON CONFLICT(reference_number) and
-- ON CONFLICT ON CONSTRAINT ... work reliably.

DO $$
BEGIN
    -- Drop old partial index if it exists
    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'payments'
          AND indexname = 'idx_payments_reference_number_unique'
    ) THEN
        DROP INDEX public.idx_payments_reference_number_unique;
    END IF;

    -- Add proper unique constraint if missing
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_reference_number_key'
          AND conrelid = 'public.payments'::regclass
    ) THEN
        ALTER TABLE public.payments
            ADD CONSTRAINT payments_reference_number_key UNIQUE (reference_number);
    END IF;
END $$;
