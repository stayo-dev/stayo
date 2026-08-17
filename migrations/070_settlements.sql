-- 070_settlements.sql
--
-- Owner settlements: Stayo pools tenant rent in its own Razorpay account and
-- passes it through to owners IN FULL. No commission is ever deducted — this
-- is a transfer pipeline, not a revenue event.
--
-- The load-bearing distinction this migration exists to enforce:
--
--   * `payments` is the OPERATIONAL record. An owner marks rent paid and picks
--     a type (cash / UPI / bank transfer). That keeps working untouched — but
--     it proves nothing about Stayo's bank balance, because an owner-marked
--     "UPI" payment went to the OWNER's UPI ID, not to Stayo.
--
--   * `gateway_transactions` is the FINANCIAL record. A row exists only when
--     the provider actually captured money into Stayo's account.
--
-- Settlement reads the second. Inferring settleability from
-- payments.payment_method would be wrong in the one direction that costs Stayo
-- money.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. What kind of money is this?
--
--    Owner subscriptions land in the SAME Razorpay account as tenant rent. If
--    a settlement run selected on "money in the account", every subscription
--    payment an owner made would be handed straight back to them — Stayo would
--    collect no revenue at all, and the bug would look like generosity.
--
--    Set at creation, never inferred. Inference breaks the first time a third
--    money type appears (deposits, refunds, penalties), and it breaks silently.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GatewayPurpose') THEN
    CREATE TYPE "GatewayPurpose" AS ENUM ('TENANT_RENT', 'OWNER_SUBSCRIPTION');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS gateway_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL DEFAULT 'razorpay',
  -- Unique: the provider webhook can and does replay. Without this, a replay
  -- would settle the same money twice.
  provider_payment_id TEXT NOT NULL UNIQUE,
  purpose             "GatewayPurpose" NOT NULL,
  amount              NUMERIC(12, 2) NOT NULL,
  -- CAPTURED | AUTHORIZED | FAILED | REFUNDED. Only CAPTURED settles.
  status              TEXT NOT NULL,
  captured_at         TIMESTAMPTZ,
  -- TENANT_RENT points at the operational payment row; unique so one payment
  -- can never be represented by two captured transactions.
  payment_id          UUID UNIQUE REFERENCES payments (id) ON DELETE SET NULL,
  hostel_id           UUID REFERENCES hostels (id) ON DELETE SET NULL,
  owner_id            UUID REFERENCES profiles (id) ON DELETE SET NULL,
  -- The provider payload, verbatim. When our interpretation and the provider
  -- disagree about real money, this is the evidence.
  raw                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The run's core query: captured tenant rent within a day.
CREATE INDEX IF NOT EXISTS idx_gateway_txn_settleable
  ON gateway_transactions (purpose, status, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_txn_owner ON gateway_transactions (owner_id);
CREATE INDEX IF NOT EXISTS idx_gateway_txn_hostel ON gateway_transactions (hostel_id);

COMMENT ON TABLE gateway_transactions IS
  'Money the provider actually captured into Stayo''s account. The financial record; `payments` is the operational one. Settlement reads this table and never payments.payment_method.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Runs and items.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One run per calendar day (IST). Unique so a second "create tonight's run"
  -- returns the existing one rather than splitting a day in two.
  run_date        DATE NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | IN_PROGRESS | COMPLETED
  gross_collected NUMERIC(14, 2) NOT NULL DEFAULT 0,
  owner_count     INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES profiles (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settlement_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES settlement_runs (id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL REFERENCES profiles (id) ON DELETE RESTRICT,
  -- What Stayo owes this owner. Deliberately NOT named `net`: there is no
  -- gross-vs-net here, and that name would invite a future fee column.
  amount         NUMERIC(14, 2) NOT NULL,
  payment_count  INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSING | PAID | FAILED | CANCELLED
  -- All null until actually paid.
  method         TEXT,
  reference      TEXT,
  paid_at        TIMESTAMPTZ,
  -- The admin who made the transfer. "Who paid this" must answer with a person.
  paid_by        UUID REFERENCES profiles (id) ON DELETE SET NULL,
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ,
  UNIQUE (run_id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_items_run ON settlement_items (run_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_items_owner ON settlement_items (owner_id, paid_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Which gateway transactions make up an item.
--
--    The unique constraint on transaction_id is what makes double payment
--    STRUCTURALLY impossible: a transaction already attached to any run cannot
--    be pulled into another. A database guarantee, not a query the next
--    developer has to remember to write.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_item_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES settlement_items (id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL UNIQUE REFERENCES gateway_transactions (id) ON DELETE RESTRICT,
  amount         NUMERIC(12, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_item_txn_item ON settlement_item_transactions (item_id);

COMMENT ON COLUMN settlement_item_transactions.transaction_id IS
  'UNIQUE across the whole table: one captured transaction can be settled exactly once, ever.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Audit log. Money leaving a bank account is never silently mutated.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     UUID REFERENCES settlement_runs (id) ON DELETE SET NULL,
  item_id    UUID REFERENCES settlement_items (id) ON DELETE SET NULL,
  action     TEXT NOT NULL, -- RUN_CREATED | ITEM_STARTED | ITEM_PAID | ITEM_FAILED | PAYOUT_ACCOUNT_CHANGED
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id   UUID REFERENCES profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlement_audit_created ON settlement_audit_log (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The owner's payout account.
--
--    Entered by the OWNER in their own Settings, not transcribed by an admin
--    from a call: a mistyped digit sends rent to a stranger irreversibly, and
--    only the owner can check it against their own passbook.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS payout_holder_name TEXT,
  ADD COLUMN IF NOT EXISTS payout_account_no  TEXT,
  ADD COLUMN IF NOT EXISTS payout_ifsc        TEXT,
  ADD COLUMN IF NOT EXISTS payout_bank_name   TEXT,
  ADD COLUMN IF NOT EXISTS payout_updated_at  TIMESTAMPTZ;

COMMENT ON COLUMN profiles.payout_account_no IS
  'Where this owner''s settled rent is sent. Owner-entered; changing it is security-sensitive (the obvious fraud is redirecting an owner''s rent) and is recorded in settlement_audit_log.';
