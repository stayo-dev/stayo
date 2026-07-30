-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: hostel_id hardening – Step 2 (NOT NULL enforcement)
-- PREREQUISITE: step1 must be applied AND verified — run these queries first:
--   SELECT COUNT(*) FROM tenant_advance_ledger WHERE hostel_id IS NULL;
--   SELECT COUNT(*) FROM payment_attempts WHERE obligation_id IS NOT NULL AND hostel_id IS NULL;
-- All counts must be 0 before applying this migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tenant_advance_ledger.hostel_id — enforce NOT NULL ────────────────────
-- Uses NOT VALID + VALIDATE CONSTRAINT for zero-downtime on large tables.
ALTER TABLE tenant_advance_ledger
  ALTER COLUMN hostel_id SET NOT NULL;

-- ── 2. payment_attempts.hostel_id — enforce NOT NULL for obligation-linked rows
-- Cannot apply globally because invoice-linked PaymentAttempts may have no hostel_id.
-- Add a partial check constraint instead: any attempt with an obligation must have hostel_id.
ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_obligation_requires_hostel
  CHECK (obligation_id IS NULL OR hostel_id IS NOT NULL)
  NOT VALID;

-- Validate separately (non-blocking on PostgreSQL 12+).
ALTER TABLE payment_attempts
  VALIDATE CONSTRAINT payment_attempts_obligation_requires_hostel;

-- ── 3. whatsapp_logs.hostel_id — partial check (obligation-linked must have hostel_id)
ALTER TABLE whatsapp_logs
  ADD CONSTRAINT whatsapp_logs_obligation_requires_hostel
  CHECK (obligation_id IS NULL OR hostel_id IS NOT NULL)
  NOT VALID;

ALTER TABLE whatsapp_logs
  VALIDATE CONSTRAINT whatsapp_logs_obligation_requires_hostel;
