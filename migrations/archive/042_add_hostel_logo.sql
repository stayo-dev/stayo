-- Add branding logo URL for hostels (used across dashboard, receipts, and emails)
ALTER TABLE hostels
ADD COLUMN IF NOT EXISTS logo_url TEXT;
