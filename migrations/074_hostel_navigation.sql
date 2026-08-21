-- 074_hostel_navigation.sql
--
-- How to actually find the front door.
--
-- A hostel's `address` is what the owner typed, and in a dense cluster near a
-- campus it resolves to the street, not the building — five hostels share it.
-- The one identifier that resolves to *this* gate is Google's Place ID,
-- collected by hand from Google's Place ID Finder. This column is where it
-- lives, and it is the single source of truth for navigation.
--
-- Deliberately NOT a stored Google Maps URL. The URL is derived from the Place
-- ID at render time; storing it too would be a second source of truth that
-- goes stale silently the first time the format changes.
--
-- Deliberately NOT in `hostel_marketing_revisions.content`. That payload is
-- written by the owner and moves with the draft/review lifecycle. Navigation is
-- platform data an admin enters at approval — the same side of the line as
-- `listing_status` and `verification_status` (see ADR-040), and for the same
-- reason: an owner must not be able to write it.
--
-- Shape (validated by NavigationSchema on both the write and the read path):
--   {
--     "placeId":               "ChIJ…",                   -- required
--     "landmark":              "Opposite SNIST Gate 2",   -- nullable
--     "entrancePhoto":         "https://ik.imagekit.io/…",-- nullable
--     "distanceFromReference": "400m",                    -- nullable
--     "referenceName":         "SNIST"
--   }
--
-- Nullable, no backfill: a hostel nobody has located yet says nothing on the
-- listing rather than showing a Get Directions button that goes to the wrong
-- building, which is worse than no button at all.

ALTER TABLE hostels
  ADD COLUMN IF NOT EXISTS navigation jsonb;

-- Finding the hostels that still need locating is an admin's first question,
-- and it is asked over the small set of live listings.
CREATE INDEX IF NOT EXISTS hostels_navigation_missing_idx
  ON hostels (listing_status)
  WHERE navigation IS NULL;
