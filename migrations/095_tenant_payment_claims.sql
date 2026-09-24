-- 095_tenant_payment_claims.sql
--
-- A tenant's assertion that they have paid — and nothing more than that.
--
-- With the payment gateway disconnected (see
-- docs/superpowers/specs/2026-09-23-upi-collection-gateway-disconnect-design.md)
-- money moves directly from tenant to owner over UPI. There is no webhook, no
-- capture event and no callback: Stayo cannot observe a payment happening. The
-- only thing that can start the process is the tenant saying so.
--
-- A row here is therefore EVIDENCE, not money. It never alters an obligation.
-- Rent is recorded only when the owner confirms the claim, and that path goes
-- through the same settlement code every other payment uses, so FIFO
-- allocation, receipts and the ledger keep exactly one implementation.
--
-- WHY A NEW TABLE rather than columns on payment_attempts:
--   1. Adding a scalar to an existing Prisma model makes every read of that
--      table without an explicit `select` demand the column. That is precisely
--      what took hostel listings down on 2026-08-22, when `navigation` shipped
--      ahead of migration 074. A new table has no such blast radius.
--   2. A tenant-initiated claim is genuinely not a gateway attempt. Modelling
--      it as one would mean carrying attempt semantics (provider, order id,
--      capture state) that can never be filled.
--
-- Unlike migration 075's columns, this table IS declared in schema.prisma:
-- it is new, so there is no existing unselected read that could break.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.

CREATE TABLE IF NOT EXISTS public.tenant_payment_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- How the claim reaches tenant/obligation/hostel/owner. The token is what
  -- the tenant actually held: it arrives in an approved WhatsApp template
  -- button and needs no login, which matters because a large share of tenants
  -- are OWNER_MANAGED and have no account at all.
  -- payment_link_tokens has no surrogate id: `token` itself is the primary key.
  token_id          uuid NOT NULL REFERENCES public.payment_link_tokens(token) ON DELETE CASCADE,

  -- Denormalised from the token so claims can be listed and scoped without a
  -- four-table join on every owner dashboard read.
  obligation_id     uuid REFERENCES public.rent_obligations(id) ON DELETE SET NULL,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hostel_id         uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  owner_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Integer paise. What the tenant says they actually sent, which for a UPI
  -- P2P intent is routinely NOT what we asked for: most apps let the payer
  -- edit the amount, so a mismatch is ordinary rather than suspicious.
  claimed_amount    bigint NOT NULL CHECK (claimed_amount > 0),

  -- The UPI reference. Required, because it is the ONLY part of a claim the
  -- owner can check against their own bank statement. A screenshot is an
  -- image; this is a number that either appears in their passbook or does not.
  utr               text NOT NULL,

  -- Supporting only. Trivially edited and endlessly reusable, so it is never
  -- treated as proof — it is accepted because owners find it reassuring and
  -- because it sometimes carries a UTR the tenant mistyped.
  proof_url         text,

  -- PENDING | CONFIRMED | REJECTED. A plain string, as most statuses in this
  -- schema are.
  state             text NOT NULL DEFAULT 'PENDING',
  rejection_reason  text,

  -- Set when the owner acts. payment_group_id ties the claim to the payment
  -- it produced, so either can be walked back to the other during a dispute.
  confirmed_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at      timestamptz,
  payment_group_id  uuid,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_payment_claims_state_check
    CHECK (state IN ('PENDING', 'CONFIRMED', 'REJECTED')),

  -- A resolved claim must say who resolved it; a pending one must not pretend
  -- anyone has. Without this, a half-written confirmation reads as confirmed.
  CONSTRAINT tenant_payment_claims_resolution_check CHECK (
    (state = 'PENDING'   AND confirmed_at IS NULL AND confirmed_by IS NULL) OR
    (state = 'CONFIRMED' AND confirmed_at IS NOT NULL) OR
    (state = 'REJECTED'  AND confirmed_at IS NOT NULL)
  )
);

-- One open claim per token.
--
-- A tenant who taps "I've paid" twice — on a slow connection, or because
-- nothing visibly happened — must not produce two claims for one payment. The
-- owner would see the same rent twice and have no way to tell which is real.
-- Partial, so the history of resolved claims on a token is kept intact.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_payment_claims_one_open_per_token
  ON public.tenant_payment_claims (token_id)
  WHERE state = 'PENDING';

-- The owner's pending-confirmation list, which is read on every dashboard load.
CREATE INDEX IF NOT EXISTS idx_tenant_payment_claims_owner_state
  ON public.tenant_payment_claims (owner_id, state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_payment_claims_tenant
  ON public.tenant_payment_claims (tenant_id, created_at DESC);

-- Duplicate-UTR detection: the same reference submitted twice, by the same
-- tenant or a different one, is the cheapest signal that something is wrong.
CREATE INDEX IF NOT EXISTS idx_tenant_payment_claims_utr
  ON public.tenant_payment_claims (utr);

-- RLS, per the convention migration 092 established. No policies: every
-- legitimate read and write goes through the backend, which connects as the
-- owning role and bypasses RLS. Enabling it with no policy is a clean lockout
-- of the public anon key, which ships in the browser bundle.
--
-- This table holds a tenant's payment references and hostel financial state,
-- so leaving it reachable by that key would be worse than most.
ALTER TABLE public.tenant_payment_claims ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tenant_payment_claims IS
  'A tenant''s assertion that they paid over UPI. Evidence, never money: an obligation changes only when the owner confirms, via the shared settlement path.';
