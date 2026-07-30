-- Add owner preferences columns on hostels table
ALTER TABLE hostels
    ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR',
    ADD COLUMN IF NOT EXISTS rent_cycle TEXT DEFAULT 'MONTHLY',
    ADD COLUMN IF NOT EXISTS receipt_prefix TEXT DEFAULT 'HMS',
    ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Kolkata';

-- Optional quality constraints
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'hostels_rent_cycle_check'
    ) THEN
        ALTER TABLE hostels
            ADD CONSTRAINT hostels_rent_cycle_check
            CHECK (rent_cycle IN ('MONTHLY', 'QUARTERLY', 'YEARLY'));
    END IF;
END $$;
