-- Migration: Add soft delete support to profiles table
-- This adds is_active column for soft deletes instead of hard deletes

-- Add is_active column
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true NOT NULL;

-- Create index for active profiles (for better query performance)
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active);

-- Update existing records to be active
UPDATE profiles SET is_active = true WHERE is_active IS NULL;

COMMENT ON COLUMN profiles.is_active IS 'Soft delete flag - false means deleted, true means active';
