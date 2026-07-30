-- Migration 009: Create Payment and Obligation Tables
-- This implements a mature accounting system where obligations are generated first and settled by payments.

-- 1. Create Status Enum if not exists (Postgres)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_status') THEN
        CREATE TYPE obligation_status AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'WAIVED');
    END IF;
END $$;

-- 2. Create rent_obligations table
CREATE TABLE IF NOT EXISTS rent_obligations (
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

-- 3. Create payments table (Actual money transactions)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    obligation_id UUID NOT NULL REFERENCES rent_obligations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount_paid NUMERIC(10, 2) NOT NULL CHECK (amount_paid > 0),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method TEXT NOT NULL, -- cash, bank_transfer, upi, etc.
    reference_number TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Essential Indexes for Financial Reporting
CREATE INDEX IF NOT EXISTS idx_obligations_student_id ON rent_obligations(student_id);
CREATE INDEX IF NOT EXISTS idx_obligations_rent_month ON rent_obligations(rent_month);
CREATE INDEX IF NOT EXISTS idx_obligations_status ON rent_obligations(status);
CREATE INDEX IF NOT EXISTS idx_payments_obligation_id ON payments(obligation_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);

-- 5. RLS Policies
ALTER TABLE rent_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Viewing policies
CREATE POLICY "Users can view own obligations" ON rent_obligations FOR SELECT TO authenticated USING (
    (auth.jwt() ->> 'role' IN ('admin', 'warden')) OR 
    (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()))
);

CREATE POLICY "Users can view own payments" ON payments FOR SELECT TO authenticated USING (
    (auth.jwt() ->> 'role' IN ('admin', 'warden')) OR 
    (student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()))
);

-- Management policies (Service Role / Admin)
CREATE POLICY "Admin/Warden can manage obligations" ON rent_obligations FOR ALL TO service_role USING (true);
CREATE POLICY "Admin/Warden can manage payments" ON payments FOR ALL TO service_role USING (true);

-- 6. Updated At Trigger
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
        CREATE TRIGGER set_updated_at_rent_obligations BEFORE UPDATE ON rent_obligations FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
    END IF;
END $$;
