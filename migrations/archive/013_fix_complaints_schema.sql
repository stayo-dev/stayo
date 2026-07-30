-- Migration 013: Fix Complaints Table Schema
-- Adds missing columns for resolution tracking and ownership.

-- 1. Add missing columns if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='resolved_at') THEN
        ALTER TABLE complaints ADD COLUMN resolved_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='staff_remarks') THEN
        ALTER TABLE complaints ADD COLUMN staff_remarks TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='updated_by') THEN
        ALTER TABLE complaints ADD COLUMN updated_by UUID REFERENCES profiles(id);
    END IF;
END $$;

-- 2. Ensure RLS Policies for Owners
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view their own tenants' complaints" ON complaints;
CREATE POLICY "Owners can view their own tenants' complaints" ON complaints FOR SELECT TO authenticated USING (
    (auth.jwt() ->> 'role' = 'owner' AND owner_id = auth.uid()) OR
    (auth.jwt() ->> 'role' = 'admin') OR
    (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()))
);

DROP POLICY IF EXISTS "Owners can update their own tenants' complaints" ON complaints;
CREATE POLICY "Owners can update their own tenants' complaints" ON complaints FOR UPDATE TO authenticated USING (
    (auth.jwt() ->> 'role' = 'owner' AND owner_id = auth.uid()) OR
    (auth.jwt() ->> 'role' = 'admin')
) WITH CHECK (
    (auth.jwt() ->> 'role' = 'owner' AND owner_id = auth.uid()) OR
    (auth.jwt() ->> 'role' = 'admin')
);
