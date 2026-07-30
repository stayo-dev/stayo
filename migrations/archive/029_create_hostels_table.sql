-- Create hostels table for owner onboarding and branding details
CREATE TABLE IF NOT EXISTS hostels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT,
    state TEXT,
    pincode TEXT,
    upi_id TEXT,
    gst_number TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- One primary hostel per owner for now
CREATE UNIQUE INDEX IF NOT EXISTS idx_hostels_owner_id_unique ON hostels(owner_id);
CREATE INDEX IF NOT EXISTS idx_hostels_active ON hostels(is_active);
