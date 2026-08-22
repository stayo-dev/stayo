-- 075_owner_payout_visibility.sql
--
-- Makes a settlement legible to the OWNER whose money it is.
--
-- Migration 070 built the payout pipeline for the admin who executes it: what
-- Stayo owes, to whom, and whether it has been transferred. It answers "who do
-- I pay tonight." It cannot answer the two questions an owner actually asks:
--
--     "When does this reach my bank?"     -> settlement_items.expected_payout_date
--     "Which of my tenants paid it?"      -> gateway_transactions.tenant_id
--
-- Both are attribution, not new money. Nothing here changes what is owed, and
-- no amount is stored twice.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.
--
-- DELIBERATELY NOT ADDED TO prisma/schema.prisma. Declaring a scalar on a
-- Prisma model makes EVERY read of that table without an explicit `select`
-- demand the column — that is what took hostel listings down on 2026-08-22 when
-- `navigation` shipped ahead of migration 074. All access to these two columns
-- is raw SQL, so application code is correct whether or not this file has been
-- applied yet.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The promise.
--
--    Stored, not derived at read time. A promise recomputed on every render can
--    never be missed — it just quietly moves. Written once when the run is
--    created, it becomes a fact that `paid_at` can be measured against, which
--    is what lets an owner be told "last 8 payouts, all on time" and lets the
--    claim be false when it is false.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE settlement_items
  ADD COLUMN IF NOT EXISTS expected_payout_date DATE;

COMMENT ON COLUMN settlement_items.expected_payout_date IS
  'The working day Stayo committed this payout would reach the owner''s bank. Set at run creation, never recomputed. Compare against paid_at for on-time reporting.';

-- Existing rows predate the promise and must not be reported as late: NULL
-- means "no promise was made", which the on-time counter skips entirely.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Whose rent it was.
--
--    A gateway transaction is exactly one captured payment by exactly one
--    tenant, so this is a true 1:1 attribution rather than a summary.
--
--    `payments` cannot stand in for it: one captured payment FIFO-allocates
--    into N obligation rows, so payments is many-per-transaction. Joining
--    through it to name the payer would either duplicate the amount or pick an
--    arbitrary row — and the amount an owner is shown must be the amount the
--    gateway captured, which is the whole point of migration 070.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE gateway_transactions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

COMMENT ON COLUMN gateway_transactions.tenant_id IS
  'The tenant who paid. Attribution only — never a settleability input. NULL for OWNER_SUBSCRIPTION, which has no tenant.';

CREATE INDEX IF NOT EXISTS idx_gateway_transactions_tenant
  ON gateway_transactions (tenant_id);

-- Owner-scoped month reads filter on owner + purpose + status and sum over a
-- captured_at range. The 070 index leads with purpose, so an owner with few
-- transactions in a table full of other owners' still scans theirs.
CREATE INDEX IF NOT EXISTS idx_gateway_transactions_owner_captured
  ON gateway_transactions (owner_id, purpose, status, captured_at DESC);
