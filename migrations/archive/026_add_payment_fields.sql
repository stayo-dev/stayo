-- Migration 026: Add receipt_url to payments
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='receipt_url') THEN
        ALTER TABLE payments ADD COLUMN receipt_url VARCHAR(1024);
    END IF;

    -- Also add owner_id to payments for easier filtering, if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='owner_id') THEN
        ALTER TABLE payments ADD COLUMN owner_id UUID REFERENCES profiles(id);
    END IF;

    -- Backfill owner_id in payments from students
    UPDATE payments p
    SET owner_id = s.owner_id
    FROM students s
    WHERE p.student_id = s.id AND p.owner_id IS NULL;

END $$;
