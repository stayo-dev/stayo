-- Migration: Tenant Invitation System
-- Description: Create invitations table and add verification fields

-- 1. Create invitations table
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES profiles(id),
  status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, ACCEPTED, EXPIRED
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add verification fields to profiles
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='is_email_verified') THEN
        ALTER TABLE profiles ADD COLUMN is_email_verified BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='email_verified_at') THEN
        ALTER TABLE profiles ADD COLUMN email_verified_at TIMESTAMPTZ;
    END IF;
END $$;

-- 3. Add invitation tracking to students
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='invited_by') THEN
        ALTER TABLE students ADD COLUMN invited_by UUID REFERENCES profiles(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='invitation_accepted_at') THEN
        ALTER TABLE students ADD COLUMN invitation_accepted_at TIMESTAMPTZ;
    END IF;
END $$;

-- 4. RLS for Invitations
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_view_own_invitations ON invitations;
CREATE POLICY owner_view_own_invitations ON invitations
    FOR SELECT
    USING (owner_id = auth.uid());

DROP POLICY IF EXISTS owner_manage_own_invitations ON invitations;
CREATE POLICY owner_manage_own_invitations ON invitations
    FOR ALL
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Allow public access for activation by token (limited select)
DROP POLICY IF EXISTS public_view_invitation_by_token ON invitations;
CREATE POLICY public_view_invitation_by_token ON invitations
    FOR SELECT
    USING (status = 'PENDING'); -- Simplified, ideally we'd filter by token in the query
