-- Migration 041: Add invitation fields for deferred user creation
-- Store invitation metadata so user creation happens on activation

ALTER TABLE invitations
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS room_id UUID,
ADD COLUMN IF NOT EXISTS monthly_rent NUMERIC,
ADD COLUMN IF NOT EXISTS invited_by UUID;

-- Index to speed up token lookups
CREATE INDEX IF NOT EXISTS idx_invitations_token
ON invitations (token);

-- Index to speed up pending invites per owner
CREATE INDEX IF NOT EXISTS idx_invitations_owner_status
ON invitations (owner_id, status);

COMMENT ON COLUMN invitations.name IS 'Invitee name stored before account creation';
COMMENT ON COLUMN invitations.phone IS 'Invitee phone stored before account creation';
COMMENT ON COLUMN invitations.room_id IS 'Room assigned at invite time';
COMMENT ON COLUMN invitations.monthly_rent IS 'Monthly rent assigned at invite time';
COMMENT ON COLUMN invitations.invited_by IS 'Owner who created the invitation';
