-- Add optional owner-scoped PhonePe merchant id override used by payment provider resolution
ALTER TABLE hostels
ADD COLUMN IF NOT EXISTS phonepe_merchant_id TEXT;
