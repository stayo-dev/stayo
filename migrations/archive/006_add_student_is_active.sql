-- Migration: Add is_active column to students table
-- This separates lifecycle status from visibility/active state

-- Add is_active column (independent of status)
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;

-- Create index for active students
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students(is_active);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_students_status_active ON students(status, is_active);

-- Update existing records to be active
UPDATE students SET is_active = true WHERE is_active IS NULL;

-- Add comment
COMMENT ON COLUMN students.is_active IS 'Soft delete flag - independent of lifecycle status. False means record is hidden/deleted but status is preserved.';

-- Example usage:
-- status = 'LEFT' + is_active = true  → Student left but record is visible
-- status = 'ACTIVE' + is_active = false → Student soft-deleted (hidden)
-- status = 'LEFT' + is_active = false → Student left AND soft-deleted

-- This allows:
-- 1. Soft delete without changing lifecycle status
-- 2. Query active students regardless of status
-- 3. Restore soft-deleted students while preserving their status
