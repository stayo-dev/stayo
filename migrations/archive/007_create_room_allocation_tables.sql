-- Migration: Create rooms and room_allocations tables
-- This module handles assigned students to rooms with capacity management

-- 1. Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_no TEXT NOT NULL UNIQUE,
    capacity INT NOT NULL DEFAULT 4,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create room_allocations table
CREATE TABLE IF NOT EXISTS room_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE, -- NULL means active allocation
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Business Rule Index: One active allocation per student
-- (A student can only have one row where end_date IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_one_active_allocation 
ON room_allocations(student_id) 
WHERE (end_date IS NULL);

-- 4. Essential Indexes for performance
CREATE INDEX IF NOT EXISTS idx_allocations_room_id ON room_allocations(room_id);
CREATE INDEX IF NOT EXISTS idx_allocations_active ON room_allocations(room_id) WHERE (end_date IS NULL);
CREATE INDEX IF NOT EXISTS idx_rooms_room_no ON rooms(room_no);

-- 5. RLS Policies (Basic)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_allocations ENABLE ROW LEVEL SECURITY;

-- Allow all to view (or customize for students vs admin)
CREATE POLICY "Allow all authenticated to view rooms" ON rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow all authenticated to view allocations" ON room_allocations FOR SELECT TO authenticated USING (true);

-- Only admins/wardens can modify (Simulated - in real app use roles)
-- For now, we assume service layer handles authorization via JWT roles
CREATE POLICY "Allow service role to manage rooms" ON rooms FOR ALL TO service_role USING (true);
CREATE POLICY "Allow service role to manage allocations" ON room_allocations FOR ALL TO service_role USING (true);

-- 6. Trigger for updated_at
-- (Assumes handle_updated_at function exists from previous migrations)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_updated_at') THEN
        CREATE TRIGGER set_updated_at_rooms BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
        CREATE TRIGGER set_updated_at_room_allocations BEFORE UPDATE ON room_allocations FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
    END IF;
END $$;
