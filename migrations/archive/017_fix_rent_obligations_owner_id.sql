-- Migration 017: Fix Rent Obligations Owner ID
-- This migration adds owner_id to rent_obligations for multi-owner isolation.

DO $$ 
BEGIN
    -- 1. Add owner_id column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rent_obligations' AND column_name='owner_id') THEN
        ALTER TABLE rent_obligations ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;

    -- 2. Populate owner_id from students table (backfill)
    UPDATE rent_obligations ro
    SET owner_id = s.owner_id
    FROM students s
    WHERE ro.student_id = s.id
    AND ro.owner_id IS NULL;

    -- 3. Update RLS policies
    ALTER TABLE rent_obligations ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Users can view own obligations" ON rent_obligations;
    CREATE POLICY "Users can view own obligations" ON rent_obligations FOR SELECT TO authenticated USING (
        (auth.jwt() ->> 'role' = 'admin' AND owner_id = auth.uid()) OR 
        (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()))
    );

    DROP POLICY IF EXISTS "Admin can manage obligations" ON rent_obligations;
    CREATE POLICY "Admin can manage obligations" ON rent_obligations FOR ALL TO authenticated USING (
        (auth.jwt() ->> 'role' = 'admin' AND owner_id = auth.uid())
    ) WITH CHECK (
        (auth.jwt() ->> 'role' = 'admin' AND owner_id = auth.uid())
    );

END $$;
