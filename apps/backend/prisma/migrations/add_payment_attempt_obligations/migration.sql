-- Migration: add_payment_attempt_obligations
-- Creates junction table for multi-obligation payments
-- Fixes XOR constraint violation for multi-obligation payments
-- Provides single source of truth for payment breakdown

-- Drop the problematic XOR constraint that breaks multi-obligation payments
ALTER TABLE "payment_attempts" DROP CONSTRAINT IF EXISTS "payment_attempts_obligation_invoice_xor_check";

-- Create junction table
CREATE TABLE IF NOT EXISTS "payment_attempt_obligations" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "payment_attempt_id" UUID NOT NULL REFERENCES "payment_attempts"(id) ON DELETE CASCADE,
    "obligation_id" UUID NOT NULL REFERENCES "rent_obligations"(id),
    amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMPTZ(6) DEFAULT now(),
    UNIQUE("payment_attempt_id", "obligation_id")
);

-- Add indexes for lookups
CREATE INDEX IF NOT EXISTS "payment_attempt_obligations_attempt_idx" ON "payment_attempt_obligations"("payment_attempt_id");
CREATE INDEX IF NOT EXISTS "payment_attempt_obligations_obligation_idx" ON "payment_attempt_obligations"("obligation_id");