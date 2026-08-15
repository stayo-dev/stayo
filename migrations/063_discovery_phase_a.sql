-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 063: Stayo Discover — phase A
--
-- Two additive changes backing the public discovery surface:
--
-- 1. visitor_leads.seeker_profile_id — links an enquiry sent from Discover to
--    the Stayo account that sent it. Without it, "my enquiries" could only be
--    reassembled by matching on phone string, which breaks the moment someone
--    edits their number, and leaves phase B's portable profile nothing to
--    attach to. Nullable because every pre-existing row, and every future
--    QR/walk-in/reception lead, has no seeker account behind it.
--
-- 2. saved_hostels — the Saved tab. An authenticated surface in the design
--    with a count on the profile screen, so localStorage would not survive a
--    device change.
--
-- Both are safe against a live table: one nullable column, one new table. No
-- backfill, no rewrite, no lock beyond the ALTER's own catalog update.
--
-- See docs/superpowers/specs/2026-08-15-discovery-phase-a-design.md
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Enquiries know which Stayo account sent them ──────────────────────────

ALTER TABLE visitor_leads
  ADD COLUMN IF NOT EXISTS seeker_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visitor_leads_seeker_profile_id_fkey'
  ) THEN
    ALTER TABLE visitor_leads
      ADD CONSTRAINT visitor_leads_seeker_profile_id_fkey
      FOREIGN KEY (seeker_profile_id) REFERENCES profiles (id);
  END IF;
END $$;

-- Drives the Enquiries tab: this seeker's leads, newest first.
CREATE INDEX IF NOT EXISTS idx_visitor_leads_seeker_created
  ON visitor_leads (seeker_profile_id, created_at DESC)
  WHERE seeker_profile_id IS NOT NULL;

-- ── 2. Saved hostels ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_hostels (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  hostel_id  uuid        NOT NULL REFERENCES hostels (id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Saving twice is a no-op, not a duplicate row — the toggle in the UI relies
-- on this to stay idempotent under a double tap.
CREATE UNIQUE INDEX IF NOT EXISTS saved_hostels_profile_hostel_key
  ON saved_hostels (profile_id, hostel_id);

-- The Saved tab reads every hostel one person saved, newest first.
CREATE INDEX IF NOT EXISTS idx_saved_hostels_profile_created
  ON saved_hostels (profile_id, created_at DESC);
