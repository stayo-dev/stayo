-- Migration 050: Reliability constraints for payment finalization
-- Idempotent, safe for production

-- 1. Add PROCESSING state to AttemptStatus enum.
--    PROCESSING is the inner mutex held by finalizePaymentAttempt while it is
--    writing payments and updating obligations. Distinct from PENDING_VERIFICATION
--    (the outer webhook-handler mutex). Together they create a two-phase lock:
--      PENDING → PENDING_VERIFICATION (webhook claims the attempt for verification)
--      PENDING_VERIFICATION → PROCESSING (finalizePaymentAttempt claims it for writing)
--    Any concurrent call that loses the PROCESSING CAS returns the fresh state
--    without writing, making the whole finalization path idempotent.
ALTER TYPE public."AttemptStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

-- 2. Partial unique index: prevent double payments for the same (attempt, obligation).
--    This is the DB-level safety net below the application-level PROCESSING lock.
--    If a bug ever causes _applyPaymentInTx to be called twice for the same pair,
--    the second INSERT will fail with a unique constraint violation and roll back.
--    Partial (WHERE payment_attempt_id IS NOT NULL) so manual/cash payments
--    (no attempt_id) are unaffected and can coexist freely.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "payments_attempt_obligation_unique"
  ON public.payments (payment_attempt_id, obligation_id)
  WHERE payment_attempt_id IS NOT NULL;

-- 3. Index to make stale-lock recovery queries fast.
--    reconcilePendingAttempts queries on (status, updated_at) to find
--    PROCESSING/PENDING_VERIFICATION rows older than 5 minutes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payment_attempts_status_updated_at_idx"
  ON public.payment_attempts (status, updated_at)
  WHERE status IN ('PROCESSING', 'PENDING_VERIFICATION', 'PENDING', 'CREATED');
