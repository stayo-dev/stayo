-- Add archive metadata columns to hostels table
-- These columns support enterprise-grade audit trails for hostel lifecycle transitions

ALTER TABLE hostels ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE hostels ADD COLUMN IF NOT EXISTS archived_by UUID;
ALTER TABLE hostels ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- Backfill: set archived_at for any already-archived hostels
UPDATE hostels
  SET archived_at = updated_at
  WHERE status = 'ARCHIVED'
    AND archived_at IS NULL;

-- Lifecycle safety trigger: prevent archiving hostels with active allocations
CREATE OR REPLACE FUNCTION prevent_archive_with_active_allocations()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status is being changed TO 'ARCHIVED'
  IF NEW.status = 'ARCHIVED' AND (OLD.status IS NULL OR OLD.status != 'ARCHIVED') THEN
    IF EXISTS (
      SELECT 1 FROM room_allocations
      WHERE hostel_id = NEW.id
        AND is_active = true
        AND (end_date IS NULL OR end_date > NOW())
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Cannot archive hostel "%" (id: %): active tenant allocations exist',
        NEW.name, NEW.id;
    END IF;
  END IF;

  -- Auto-populate archived_at when archiving
  IF NEW.status = 'ARCHIVED' AND (OLD.status IS NULL OR OLD.status != 'ARCHIVED') THEN
    NEW.archived_at := NOW();
  END IF;

  -- Clear archive metadata when restoring
  IF OLD.status = 'ARCHIVED' AND NEW.status != 'ARCHIVED' THEN
    NEW.archived_at := NULL;
    NEW.archived_by := NULL;
    NEW.archive_reason := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_archive_with_active_allocations ON hostels;
CREATE TRIGGER trg_prevent_archive_with_active_allocations
  BEFORE UPDATE ON hostels
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION prevent_archive_with_active_allocations();

COMMENT ON FUNCTION prevent_archive_with_active_allocations() IS
  'Lifecycle safety net: prevents archiving hostels with active allocations. '
  'Also auto-manages archived_at metadata. Applied as BEFORE UPDATE trigger.';
