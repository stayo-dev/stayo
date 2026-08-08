-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 062: A `tenants` row is one tenancy, not one person
--
-- 1. Drop the global UNIQUE on tenants.profile_id — a person may stay in several
--    hostels over time, each stay its own row with its own payments, obligations,
--    agreements and allocations.
-- 2. Enforce the real rule instead: at most ONE *live* tenancy per profile.
--    Because activation is what sets profile_id, this index also stops two owners
--    from both driving the same person to activation (the rival-invite race).
-- 3. Drop the partial-deposit reservation policy columns. They existed only to
--    compute the onboarding payment gate's threshold, and the gate is gone —
--    a tenant now gets their room on joining and pays deposit/maintenance after.
--
-- See docs/superpowers/specs/2026-08-07-tenant-join-without-payment-gate-design.md
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. profile_id is no longer globally unique ───────────────────────────────

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_profile_id_key;
DROP INDEX IF EXISTS tenants_profile_id_key;

CREATE INDEX IF NOT EXISTS tenants_profile_id_idx ON tenants (profile_id);

-- ── 2. One live tenancy per person ───────────────────────────────────────────
-- Fails loudly if the data already violates it, which is the point: silently
-- skipping would leave the invariant unenforced.

CREATE UNIQUE INDEX IF NOT EXISTS tenants_one_live_tenancy_per_profile
  ON tenants (profile_id)
  WHERE profile_id IS NOT NULL AND status IN ('INVITED', 'ACTIVE');

-- ── 3. Drop the reservation-threshold columns ────────────────────────────────

ALTER TABLE tenants DROP COLUMN IF EXISTS reservation_policy;
ALTER TABLE tenants DROP COLUMN IF EXISTS minimum_reservation_deposit;
