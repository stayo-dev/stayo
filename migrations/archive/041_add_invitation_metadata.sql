-- Migration 041: Add invitation metadata for deferred account creation
-- Adds fields to invitations table so we can create users only on activation

ALTER TABLE invitations
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS room_id UUID,
ADD COLUMN IF NOT EXISTS monthly_rent NUMERIC,
ADD COLUMN IF NOT EXISTS invited_by UUID;

-- Optional indexes for lookup
CREATE INDEX IF NOT EXISTS idx_invitations_room_id ON invitations (room_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations (status);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON invitations (invited_by);
