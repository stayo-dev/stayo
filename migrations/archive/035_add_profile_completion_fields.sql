-- Add fields for profile completion tracking to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_profile_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS college_roll_number VARCHAR,
  ADD COLUMN IF NOT EXISTS section VARCHAR,
  ADD COLUMN IF NOT EXISTS branch VARCHAR,
  ADD COLUMN IF NOT EXISTS year_of_study VARCHAR,
  ADD COLUMN IF NOT EXISTS parent_phone VARCHAR;

-- Add unique constraint to college_roll_number avoiding NULL conflicts
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_college_roll_number
ON profiles (college_roll_number)
WHERE college_roll_number IS NOT NULL;

-- Automatically mark existing admins/owners as having completed profiles
UPDATE profiles
SET is_profile_completed = TRUE
WHERE role IN ('admin', 'owner');
