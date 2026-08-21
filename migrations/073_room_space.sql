-- 073_room_space.sql
--
-- What a room is actually like to live in: its size, and where your things go.
--
-- `rooms` has always carried capacity, rent and floor — the operator's view.
-- None of it answers the two questions a person choosing a hostel asks after
-- the price: **how big is it**, and **where do I put my stuff**. "120 sq ft"
-- would not answer them either, which is why these are two measurements an
-- owner can take with a tape rather than one derived area: a 6×20 room and an
-- 11×11 room are the same area and completely different to live in.
--
-- Every column is nullable. Nothing here is retrofitted or guessed for the
-- rooms that already exist; a room with no measurements simply says nothing,
-- rather than showing a plausible default. See the design note at
-- docs/superpowers/specs/2026-08-20-feeling-the-room-design.md

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS length_ft         numeric(5,1),
  ADD COLUMN IF NOT EXISTS width_ft          numeric(5,1),
  -- One lockable cupboard per bed, or shared/none.
  ADD COLUMN IF NOT EXISTS cupboard_per_bed  boolean,
  -- NONE | CABIN_BAG | LARGE_SUITCASE — storage counted as objects that fit.
  ADD COLUMN IF NOT EXISTS under_bed_storage text,
  -- NONE | SHARED | PER_BED
  ADD COLUMN IF NOT EXISTS study_desk        text,
  ADD COLUMN IF NOT EXISTS windows           smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_space_check') THEN
    ALTER TABLE rooms ADD CONSTRAINT rooms_space_check CHECK (
      (length_ft IS NULL OR (length_ft > 0 AND length_ft <= 100)) AND
      (width_ft  IS NULL OR (width_ft  > 0 AND width_ft  <= 100)) AND
      (windows   IS NULL OR (windows  >= 0 AND windows   <= 20)) AND
      (under_bed_storage IS NULL OR under_bed_storage IN ('NONE','CABIN_BAG','LARGE_SUITCASE')) AND
      (study_desk        IS NULL OR study_desk        IN ('NONE','SHARED','PER_BED'))
    );
  END IF;
END $$;
