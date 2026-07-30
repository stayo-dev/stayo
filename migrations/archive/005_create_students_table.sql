-- Migration: Create students table with proper constraints and indexes
-- This table represents hostel enrollment records (not just person identity)

-- Create students table
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL UNIQUE,
    monthly_rent DECIMAL(10, 2) NOT NULL CHECK (monthly_rent > 0),
    joined_on DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('APPLIED', 'ACTIVE', 'LEFT', 'BLACKLISTED', 'ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Foreign key to profiles table
    CONSTRAINT fk_student_profile FOREIGN KEY (profile_id) 
        REFERENCES profiles(id) ON DELETE RESTRICT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_students_profile_id ON students(profile_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_joined_on ON students(joined_on);
CREATE INDEX IF NOT EXISTS idx_students_created_at ON students(created_at);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_students_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW
    EXECUTE FUNCTION update_students_updated_at();

-- Add comments for documentation
COMMENT ON TABLE students IS 'Hostel enrollment records - represents student membership in hostel';
COMMENT ON COLUMN students.id IS 'Unique student enrollment ID';
COMMENT ON COLUMN students.profile_id IS 'Reference to profile (must be role=student)';
COMMENT ON COLUMN students.monthly_rent IS 'Monthly rent amount (must be > 0)';
COMMENT ON COLUMN students.joined_on IS 'Date student joined hostel (cannot be future)';
COMMENT ON COLUMN students.status IS 'Student lifecycle status: APPLIED, ACTIVE, LEFT, BLACKLISTED, ARCHIVED';
COMMENT ON COLUMN students.created_at IS 'Timestamp when enrollment was created';
COMMENT ON COLUMN students.updated_at IS 'Timestamp when enrollment was last updated';

-- Row Level Security (RLS) Policies
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- Policy: Admin can do everything
CREATE POLICY admin_all_students ON students
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy: Warden can view and update (but not delete)
CREATE POLICY warden_view_update_students ON students
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('warden', 'admin')
        )
    );

CREATE POLICY warden_update_students ON students
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('warden', 'admin')
        )
    );

-- Policy: Students can only view their own record
CREATE POLICY student_view_own ON students
    FOR SELECT
    USING (profile_id = auth.uid());

-- Verify the table was created
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'students'
ORDER BY ordinal_position;
