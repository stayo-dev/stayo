-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 077: Room preference on enquiries
--
-- Lets a tenant express which floor/room they'd like when sending an enquiry
-- (`visitor_leads`) — a movie-seat-style picker on the Discover enquiry page.
-- Both columns are a *preference*, never a reservation: nothing here holds a
-- bed, and the owner's Invite Tenant wizard re-checks live availability via
-- the existing `roomCapacityService` before ever assigning a room.
--
-- Both nullable, independently: a tenant may pick just a floor ("any room on
-- Ground") or a specific room. `ON DELETE SET NULL` on both FKs — if an owner
-- later deletes the floor or room, the enquiry must not break, it just loses
-- a stale preference.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE visitor_leads
  ADD COLUMN IF NOT EXISTS preferred_floor_id uuid,
  ADD COLUMN IF NOT EXISTS preferred_room_id  uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visitor_leads_preferred_floor_id_fkey'
  ) THEN
    ALTER TABLE visitor_leads
      ADD CONSTRAINT visitor_leads_preferred_floor_id_fkey
      FOREIGN KEY (preferred_floor_id) REFERENCES floors (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'visitor_leads_preferred_room_id_fkey'
  ) THEN
    ALTER TABLE visitor_leads
      ADD CONSTRAINT visitor_leads_preferred_room_id_fkey
      FOREIGN KEY (preferred_room_id) REFERENCES rooms (id) ON DELETE SET NULL;
  END IF;
END $$;

-- Drives the "is my preferred room still available" check on the owner's
-- Accept → Invite step.
CREATE INDEX IF NOT EXISTS idx_visitor_leads_preferred_room
  ON visitor_leads (preferred_room_id)
  WHERE preferred_room_id IS NOT NULL;
