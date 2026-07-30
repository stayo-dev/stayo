-- Migration 019: Enable Comprehensive Multi-tenant Isolation
-- This script enables RLS on all operational tables and enforces owner_id isolation.

DO $$ 
DECLARE
    t_name text;
    tables text[] := ARRAY['rooms', 'room_allocations', 'rent_obligations', 'payments', 'complaints', 'notifications', 'expenses', 'students'];
BEGIN
    -- 1. Enable RLS on all target tables
    FOR i IN 1 .. array_length(tables, 1) LOOP
        t_name := tables[i];
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t_name);
        
        -- Drop any old open policies safely
        -- We won't drop everything just in case, but we will create new overarching ones 
        -- Replacing them by creating OR REPLACE is not supported for policies, so we DROP IF EXISTS
        EXECUTE format('DROP POLICY IF EXISTS "Owner can manage own %I" ON %I;', t_name, t_name);
        EXECUTE format('DROP POLICY IF EXISTS "Owner full access to %I" ON %I;', t_name, t_name);
        EXECUTE format('DROP POLICY IF EXISTS "Student can view own %I" ON %I;', t_name, t_name);
        
        -- 2. Create Owner Policies (Owner sees all records they own)
        EXECUTE format('
            CREATE POLICY "Owner full access to %I" ON %I
            FOR ALL
            USING (auth.uid() = owner_id)
            WITH CHECK (auth.uid() = owner_id);
        ', t_name, t_name);
    END LOOP;
END $$;

-- 3. Specialized Student/Tenant SELECT Policies
-- Students must be able to view their own records across these tables

-- students table
DROP POLICY IF EXISTS "Student can view own students" ON students;
CREATE POLICY "Student can view own students" ON students
    FOR SELECT USING (auth.uid() = profile_id);

-- room_allocations
DROP POLICY IF EXISTS "Student can view own room_allocations" ON room_allocations;
CREATE POLICY "Student can view own room_allocations" ON room_allocations
    FOR SELECT USING (auth.uid() = (SELECT profile_id FROM students WHERE students.id = room_allocations.student_id));

-- rent_obligations
DROP POLICY IF EXISTS "Student can view own rent_obligations" ON rent_obligations;
CREATE POLICY "Student can view own rent_obligations" ON rent_obligations
    FOR SELECT USING (auth.uid() = (SELECT profile_id FROM students WHERE students.id = rent_obligations.student_id));

-- payments
DROP POLICY IF EXISTS "Student can view own payments" ON payments;
CREATE POLICY "Student can view own payments" ON payments
    FOR SELECT USING (auth.uid() = (SELECT profile_id FROM students WHERE students.id = payments.student_id));

-- complaints
DROP POLICY IF EXISTS "Student can view own complaints" ON complaints;
CREATE POLICY "Student can view own complaints" ON complaints
    FOR SELECT USING (auth.uid() = student_id); -- assuming student_id here links to profile_id, wait, complaints has student_id. We need to check schemas if complains.student_id references auth.uid or students.id. Let's rely on profiles for now but give them their own isolated view.
    -- Wait, complaints.student_id references profiles.id in earlier migrations. We'll use auth.uid() = student_id.
    
DROP POLICY IF EXISTS "Student can insert own complaints" ON complaints;
CREATE POLICY "Student can insert own complaints" ON complaints
    FOR INSERT WITH CHECK (auth.uid() = student_id);

-- notifications
DROP POLICY IF EXISTS "Student can view own notifications" ON notifications;
CREATE POLICY "Student can view own notifications" ON notifications
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL AND auth.uid() IN (SELECT profile_id FROM students WHERE status='ACTIVE'));

-- 4. Fix Profiles Table (Owners can see their tenants, tenants can see themselves)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view and manage their own profile or their tenants" ON profiles;
CREATE POLICY "Users can view and manage their own profile or their tenants" ON profiles
    FOR ALL
    USING (auth.uid() = id OR auth.uid() = owner_id)
    WITH CHECK (auth.uid() = id OR auth.uid() = owner_id);
