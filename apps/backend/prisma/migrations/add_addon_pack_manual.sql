-- ============================================================
-- Migration: Addon hardening (run in Supabase SQL Editor)
-- ============================================================

-- 1. addon_pack column on payment_attempts (may already exist)
ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS addon_pack TEXT;

-- 2. auto_topup flag on addon_usage
ALTER TABLE public.addon_usage
  ADD COLUMN IF NOT EXISTS auto_topup BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. AddonTransaction audit table
CREATE TABLE IF NOT EXISTS public.addon_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID NOT NULL,
  payment_attempt_id UUID,
  pack               TEXT NOT NULL,
  credits_added      INT  NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS addon_transactions_owner_id_idx
  ON public.addon_transactions (owner_id);

COMMENT ON TABLE public.addon_transactions IS
  'Immutable ledger of every reminder credit top-up. Required for disputes, debugging, and refunds.';
