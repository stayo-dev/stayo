ALTER TABLE hostels
    ADD COLUMN IF NOT EXISTS auto_rent_day INTEGER DEFAULT 1;

UPDATE hostels
SET auto_rent_day = 1
WHERE auto_rent_day IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'hostels_auto_rent_day_check'
    ) THEN
        ALTER TABLE hostels
            ADD CONSTRAINT hostels_auto_rent_day_check
            CHECK (auto_rent_day >= 1 AND auto_rent_day <= 28);
    END IF;
END $$;
