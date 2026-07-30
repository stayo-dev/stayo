-- Tenant lifecycle expansion + reactivation requests

-- 1) Expand students.status allowed values for lifecycle UX
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'students'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%IN%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE students DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

-- Normalize deprecated statuses into LEFT for simplified lifecycle
UPDATE students
SET status = 'LEFT'
WHERE status IN ('INACTIVE', 'BLOCKED', 'BLACKLISTED', 'ARCHIVED', 'APPLIED', 'PENDING_APPROVAL');

ALTER TABLE students
ADD CONSTRAINT chk_students_status_lifecycle
CHECK (
    status IN (
        'INVITED',
        'ACTIVE',
        'LEFT'
    )
);

-- 2) Tenant reactivation request table
CREATE TABLE IF NOT EXISTS public.reactivation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    requested_by_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    current_status TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- One open request at a time per student
CREATE UNIQUE INDEX IF NOT EXISTS uq_reactivation_requests_student_pending
ON public.reactivation_requests(student_id)
WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_reactivation_requests_owner_created
ON public.reactivation_requests(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reactivation_requests_student_created
ON public.reactivation_requests(student_id, created_at DESC);

ALTER TABLE public.reactivation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_create_own_reactivation_request ON public.reactivation_requests;
CREATE POLICY student_create_own_reactivation_request
ON public.reactivation_requests FOR INSERT
WITH CHECK (requested_by_profile_id = auth.uid());

DROP POLICY IF EXISTS student_view_own_reactivation_request ON public.reactivation_requests;
CREATE POLICY student_view_own_reactivation_request
ON public.reactivation_requests FOR SELECT
USING (requested_by_profile_id = auth.uid());

DROP POLICY IF EXISTS owner_view_own_reactivation_requests ON public.reactivation_requests;
CREATE POLICY owner_view_own_reactivation_requests
ON public.reactivation_requests FOR SELECT
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS owner_update_own_reactivation_requests ON public.reactivation_requests;
CREATE POLICY owner_update_own_reactivation_requests
ON public.reactivation_requests FOR UPDATE
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());
