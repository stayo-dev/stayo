"""
Add database indexes for crucial optimizations.
"""
-- Optimal indexes for frequently queried columns

-- Profile ID lookups (used heavily for auth matching)
CREATE INDEX IF NOT EXISTS idx_students_profile_id ON public.students(profile_id);

-- Student ID lookups (used in allocations, payments, obligations, etc)
CREATE INDEX IF NOT EXISTS idx_room_allocations_student_id ON public.room_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_rent_obligations_student_id ON public.rent_obligations(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON public.payments(student_id);
CREATE INDEX IF NOT EXISTS idx_complaints_student_id ON public.complaints(student_id);

-- Room ID lookups
CREATE INDEX IF NOT EXISTS idx_room_allocations_room_id ON public.room_allocations(room_id);

-- Status and Filtering Columns
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_rent_obligations_status ON public.rent_obligations(status);
CREATE INDEX IF NOT EXISTS idx_students_is_active ON public.students(is_active);

-- Date filtering (created_at, due_date)
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rent_obligations_due_date ON public.rent_obligations(due_date);

-- Composite Indexes
-- Active allocations for a student
CREATE INDEX IF NOT EXISTS idx_allocations_active ON public.room_allocations(student_id) WHERE end_date IS NULL;
-- Unpaid obligations for student
CREATE INDEX IF NOT EXISTS idx_rent_obligations_unpaid ON public.rent_obligations(student_id, status) WHERE status = 'pending';
