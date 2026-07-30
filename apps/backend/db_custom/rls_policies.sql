-- Step 1: Prevent over-allocation dynamically
CREATE OR REPLACE FUNCTION check_room_capacity()
RETURNS trigger AS $$
BEGIN
  IF (
    SELECT COUNT(*) 
    FROM room_allocations
    WHERE room_id = NEW.room_id
    AND is_active = true
  ) >= (
    SELECT capacity FROM rooms WHERE id = NEW.room_id
  )
  THEN
    RAISE EXCEPTION 'Room capacity exceeded for room %', NEW.room_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_room_capacity ON room_allocations;

CREATE TRIGGER enforce_room_capacity
BEFORE INSERT OR UPDATE OF room_id, is_active ON room_allocations
FOR EACH ROW
WHEN (NEW.is_active = true)
EXECUTE FUNCTION check_room_capacity();