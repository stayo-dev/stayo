-- Phase 7: Decommission SaaS Infrastructure
-- Single-Business Migration — drop all SaaS-only tables
--
-- ALL tables here are runtime-dead as of this migration:
--   * No active Prisma model references (verified by grep sweep)
--   * No active imports in routes or services
--   * Corresponding service files deleted in this phase
--   * Reconciliation engine rebuilt against payment_attempts/payments/rent_obligations
--
-- TABLES KEPT (explicitly excluded):
--   * owner_dashboard_snapshots — pending repurpose as PortfolioSnapshot
--   * exit_settlement_transactions — operational (tenant move-out deposit settlement)
--   * financial_reconciliation_issues — active admin reconciliation audit table
--
-- Idempotent: IF EXISTS on every statement.
-- CASCADE: drops FK constraints that reference each dropped table.

BEGIN;

-- 1. Payout / treasury ledger (innermost FK deps first)
DROP TABLE IF EXISTS public.settlement_batch_items CASCADE;
DROP TABLE IF EXISTS public.owner_settlement_ledger CASCADE;
DROP TABLE IF EXISTS public.settlement_batches CASCADE;

-- 2. Subscription + billing tables
DROP TABLE IF EXISTS public.autopay_attempts CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;

-- 3. Overflow billing
DROP TABLE IF EXISTS public.overflow_ledger CASCADE;
DROP TABLE IF EXISTS public.owner_subscriptions CASCADE;

-- 4. Remove orphaned invoice FK column from payment_attempts
--    (FK constraint was dropped by CASCADE above; column remains until explicitly dropped)
ALTER TABLE public.payment_attempts DROP COLUMN IF EXISTS invoice_id;

-- 5. Owner invoices and plan definitions
DROP TABLE IF EXISTS public.owner_invoices CASCADE;
DROP TABLE IF EXISTS public.plans CASCADE;

-- 6. Usage / onboarding artifacts
DROP TABLE IF EXISTS public.owner_onboarding_states CASCADE;
DROP TABLE IF EXISTS public.owner_usage_snapshots CASCADE;

-- 7. Addon tables
DROP TABLE IF EXISTS public.addon_transactions CASCADE;
DROP TABLE IF EXISTS public.addon_usage CASCADE;

COMMIT;
