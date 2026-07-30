-- Migration 025: Drop Complaints System
-- Epic 2: Remove complaints/maintenance module (client no longer requires it)
-- WARNING: This migration is DESTRUCTIVE and cannot be rolled back without a backup.

-- 1. Drop all RLS policies on complaints table
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies WHERE tablename = 'complaints'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON complaints', pol.policyname);
    END LOOP;
END $$;

-- 2. Drop indexes on complaints table
DROP INDEX IF EXISTS idx_complaints_student;
DROP INDEX IF EXISTS idx_complaints_status;
DROP INDEX IF EXISTS idx_complaints_category;

-- 3. Drop the complaints table (CASCADE drops foreign keys)
DROP TABLE IF EXISTS complaints CASCADE;

-- 4. Drop custom ENUM types used by complaints
DROP TYPE IF EXISTS complaint_status CASCADE;
DROP TYPE IF EXISTS complaint_priority CASCADE;
DROP TYPE IF EXISTS complaint_category CASCADE;

-- 5. Verify removal
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%complaint%';
-- Expected: 0 rows
