-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 065: Residency history disclosure
--
-- A tenant's stay history already exists — since migration 062 a `tenants` row
-- IS one tenancy, and room_allocations + move_out_requests carry the rest. It
-- has simply never had a reader.
--
-- What this table adds is the tenant's control over WHO reads it.
--
-- Access is normally *derived* from engagement: a hostel sees a person's
-- history because that person enquired to them or holds a tenancy there.
-- Derived access cannot go stale and cannot leak through a forgotten grant.
-- This table exists only for the cases derivation cannot express:
--
--   * REQUESTED — an owner wants to see the history of someone who has not
--     engaged them yet (the invite flow). Without this, showing history at
--     invite time would rebuild the lookup-by-email oracle ADR-053 blocks.
--   * APPROVED  — the tenant said yes to such a request.
--   * DECLINED  — the tenant said no.
--   * REVOKED   — the tenant withdrew access they would otherwise have by
--                 engagement. This OVERRIDES derivation, which is the whole
--                 point of giving the tenant control.
--
-- No row means "fall back to engagement".
--
-- See docs/superpowers/specs/ — residency history, and ADR-053's amendment.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS residency_history_disclosures (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  hostel_id    uuid        NOT NULL REFERENCES hostels (id)  ON DELETE CASCADE,

  -- REQUESTED | APPROVED | DECLINED | REVOKED
  status       text        NOT NULL DEFAULT 'REQUESTED',

  -- Who asked. Null when the tenant granted or revoked without being asked.
  requested_by uuid        REFERENCES profiles (id),
  requested_at timestamptz,
  decided_at   timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz
);

-- One standing decision per (person, hostel). A second request re-opens the
-- existing row rather than stacking a rival decision beside it.
CREATE UNIQUE INDEX IF NOT EXISTS residency_history_disclosures_profile_hostel_key
  ON residency_history_disclosures (profile_id, hostel_id);

-- The tenant's "who can see my history" screen.
CREATE INDEX IF NOT EXISTS idx_residency_disclosures_profile_status
  ON residency_history_disclosures (profile_id, status);

-- The owner's pending-request lookup.
CREATE INDEX IF NOT EXISTS idx_residency_disclosures_hostel_status
  ON residency_history_disclosures (hostel_id, status);
