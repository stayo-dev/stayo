-- Migration 012: Ensure Rent Obligations and Payments Tables Exist
-- This migration recreates the missing financial tables identified during debugging.

-- 1. Create Status Enum if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_status') THEN
        CREATE TYPE obligation_status AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'WAIVED');
    END IF;
END $$;

-- 2. Create rent_obligations table
DROP TABLE IF EXISTS rent_obligations CASCADE;
CREATE TABLE rent_obligations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    allocation_id UUID NOT NULL REFERENCES room_allocations(id) ON DELETE CASCADE,
    rent_month DATE NOT NULL, -- Stored as YYYY-MM-01
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    due_date DATE NOT NULL,
    status obligation_status NOT NULL DEFAULT 'PENDING',
    generated_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Constraint: Only one rent obligation per student per month
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_month_unique ON rent_obligations(student_id, rent_month);

-- 3. Create payments table
DROP TABLE IF EXISTS payments CASCADE;
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    obligation_id UUID NOT NULL REFERENCES rent_obligations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid > 0),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method TEXT NOT NULL, -- cash, bank_transfer, upi, etc.
    reference_number TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Essential Indexes
CREATE INDEX IF NOT EXISTS idx_obligations_student_id ON rent_obligations(student_id);
CREATE INDEX IF NOT EXISTS idx_obligations_rent_month ON rent_obligations(rent_month);
CREATE INDEX IF NOT EXISTS idx_obligations_status ON rent_obligations(status);
CREATE INDEX IF NOT EXISTS idx_payments_obligation_id ON payments(obligation_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);

-- 5. RLS Policies
ALTER TABLE rent_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Viewing policies
DROP POLICY IF EXISTS "Users can view own obligations" ON rent_obligations;
CREATE POLICY "Users can view own obligations" ON rent_obligations FOR SELECT TO authenticated USING (
    (auth.jwt() ->> 'role' IN ('admin', 'warden', 'owner')) OR 
    (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()))
);

DROP POLICY IF EXISTS "Users can view own payments" ON payments;
CREATE POLICY "Users can view own payments" ON payments FOR SELECT TO authenticated USING (
    (auth.jwt() ->> 'role' IN ('admin', 'warden', 'owner')) OR 
    (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()))
);

-- Management policies (Service Role / Admin)
DROP POLICY IF EXISTS "Admin/Warden/Owner can manage obligations" ON rent_obligations;
CREATE POLICY "Admin/Warden/Owner can manage obligations" ON rent_obligations FOR ALL TO authenticated USING (
    (auth.jwt() ->> 'role' IN ('admin', 'warden', 'owner'))
);

DROP POLICY IF EXISTS "Admin/Warden/Owner can manage payments" ON payments;
CREATE POLICY "Admin/Warden/Owner can manage payments" ON payments FOR ALL TO authenticated USING (
    (auth.jwt() ->> 'role' IN ('admin', 'warden', 'owner'))
);
