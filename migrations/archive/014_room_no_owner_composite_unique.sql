-- Migration 014: Replace global room_no UNIQUE with per-owner composite unique
-- This allows different owners to each have their own "Room 101"

-- 1. Drop the old global unique constraint (created in migration 007)
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_room_no_key;

-- 2. Drop old index if it exists separately
DROP INDEX IF EXISTS idx_rooms_room_no;

-- 3. Add a composite unique constraint: same room_no is only unique per owner
ALTER TABLE rooms ADD CONSTRAINT rooms_room_no_owner_unique UNIQUE (room_no, owner_id);

-- 4. Recreate index for performance (still useful for per-owner lookups)
CREATE INDEX IF NOT EXISTS idx_rooms_owner_room_no ON rooms(owner_id, room_no);
