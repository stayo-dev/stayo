-- Migration: Add owner_id for multi-owner isolation and create invitation_tokens table

-- 1. Add owner_id to relevant tables
DO $$ 
BEGIN
    -- Add owner_id to profiles if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='owner_id') THEN
        ALTER TABLE profiles ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;

    -- Add owner_id to rooms if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='rooms' AND column_name='owner_id') THEN
        ALTER TABLE rooms ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;

    -- Add owner_id to payments if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='owner_id') THEN
        ALTER TABLE payments ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;

    -- Add owner_id to complaints if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='complaints' AND column_name='owner_id') THEN
        ALTER TABLE complaints ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;

    -- Add owner_id to notifications if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='owner_id') THEN
        ALTER TABLE notifications ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;

    -- Add owner_id to expenses if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='owner_id') THEN
        ALTER TABLE expenses ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;
END $$;

-- 2. Create invitation_tokens table
CREATE TABLE IF NOT EXISTS invitation_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Update Profile Status / Role constraints if needed
-- (The user mentioned no warden, only student and owner/admin)
-- We will keep them for now but functional logic will ignore warden.

-- 4. RLS Policies for Owner Isolation
-- (Example for rooms - apply similar logic to others)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_manage_own_rooms ON rooms;
CREATE POLICY owner_manage_own_rooms ON rooms
    FOR ALL
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- RLS for Profiles (Owner can manage their own tenants)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_manage_own_tenants ON profiles;
CREATE POLICY owner_manage_own_tenants ON profiles
    FOR ALL
    USING (owner_id = auth.uid() OR id = auth.uid());
