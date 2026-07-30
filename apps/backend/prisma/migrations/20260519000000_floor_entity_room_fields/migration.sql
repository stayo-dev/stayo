-- Migration: 20260519000000_floor_entity_room_fields
-- Additive only — production live, zero downtime

BEGIN;

-- ─── 1. Create floors table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS floors (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hostel_id  UUID        NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  owner_id   UUID        NOT NULL,
  name       TEXT        NOT NULL,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS floors_hostel_id_idx ON floors(hostel_id);
CREATE INDEX IF NOT EXISTS floors_owner_id_idx  ON floors(owner_id);

-- ─── 2. Add new columns to rooms ────────────────────────────────────────────
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS floor_id      UUID REFERENCES floors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wifi_name     TEXT,
  ADD COLUMN IF NOT EXISTS wifi_password TEXT,
  ADD COLUMN IF NOT EXISTS notes         TEXT;

CREATE INDEX IF NOT EXISTS rooms_floor_id_idx ON rooms(floor_id);

-- ─── 3. Backfill floors from existing floor integer values ──────────────────
-- For each distinct (hostel_id, floor) pair, create one floors row.
-- floor = NULL is treated as 0 (Ground Floor).
INSERT INTO floors (id, hostel_id, owner_id, name, sort_order)
SELECT
  gen_random_uuid(),
  r.hostel_id,
  h.owner_id,
  CASE COALESCE(r.floor, 0)
    WHEN 0 THEN 'Ground Floor'
    WHEN 1 THEN '1st Floor'
    WHEN 2 THEN '2nd Floor'
    WHEN 3 THEN '3rd Floor'
    WHEN 4 THEN '4th Floor'
    WHEN 5 THEN '5th Floor'
    ELSE COALESCE(r.floor, 0)::TEXT || 'th Floor'
  END,
  COALESCE(r.floor, 0)
FROM (
  SELECT DISTINCT hostel_id, floor FROM rooms WHERE is_active = TRUE
) r
JOIN hostels h ON h.id = r.hostel_id
ON CONFLICT DO NOTHING;

-- ─── 4. Set floor_id on existing rooms using the backfilled records ──────────
UPDATE rooms r
SET    floor_id = f.id
FROM   floors f
WHERE  f.hostel_id  = r.hostel_id
  AND  f.sort_order = COALESCE(r.floor, 0)
  AND  r.floor_id   IS NULL
  AND  r.is_active  = TRUE;

COMMIT;
