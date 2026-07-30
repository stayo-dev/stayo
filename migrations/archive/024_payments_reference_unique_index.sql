-- Migration 024: Add unique index on payments.reference_number
-- Required for the idempotent upsert in record_payment() to work correctly.
-- Payments recorded via Razorpay use the razorpay_payment_id as the reference_number,
-- so this index prevents duplicate payment rows for the same Razorpay transaction.

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference_number_unique
    ON payments(reference_number)
    WHERE reference_number IS NOT NULL;
