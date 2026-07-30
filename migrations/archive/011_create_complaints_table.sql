-- Migration 011: Create complaints and maintenance tables
-- This module allows students to report issues and staff to track resolution.

CREATE TYPE complaint_status AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');
CREATE TYPE complaint_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE complaint_category AS ENUM ('ELECTRICAL', 'PLUMBING', 'CLEANING', 'CARPENTRY', 'INTERNET', 'OTHER');

CREATE TABLE complaints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category complaint_category NOT NULL DEFAULT 'OTHER',
    status complaint_status NOT NULL DEFAULT 'PENDING',
    priority complaint_priority NOT NULL DEFAULT 'MEDIUM',
    
    -- Admin/Staff notes
    staff_remarks TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit trail
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id)
);

-- Indexes for performance
CREATE INDEX idx_complaints_student ON complaints(student_id);
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_complaints_category ON complaints(category);

-- RLS Policies
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

-- Students can view their own complaints
CREATE POLICY "Students can view own complaints" ON complaints
    FOR SELECT USING (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()));

-- Students can create their own complaints
CREATE POLICY "Students can create own complaints" ON complaints
    FOR INSERT WITH CHECK (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()));

-- Admins and Wardens can view and update all complaints
CREATE POLICY "Admins/Wardens can view all complaints" ON complaints
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'warden')
        )
    );

COMMENT ON TABLE complaints IS 'Student complaints and maintenance requests';
