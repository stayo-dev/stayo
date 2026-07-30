-- Migration 028: Improve owner-scoped payment report/dashboard query performance
-- Covers common access pattern:
--   WHERE owner_id = ?
--   ORDER BY created_at DESC

CREATE INDEX IF NOT EXISTS idx_payments_owner_created
ON public.payments(owner_id, created_at DESC);
