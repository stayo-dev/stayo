-- Add aadhaar_number to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(12);

-- Add index for aadhaar_number
CREATE INDEX IF NOT EXISTS idx_profiles_aadhaar_number ON profiles (aadhaar_number);
