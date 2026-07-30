-- Add student-specific academic fields
ALTER TABLE IF EXISTS public.students
ADD COLUMN IF NOT EXISTS roll_number TEXT,
ADD COLUMN IF NOT EXISTS year_of_study INTEGER,
ADD COLUMN IF NOT EXISTS section TEXT,
ADD COLUMN IF NOT EXISTS course TEXT;

-- Optional guardrail for allowed year values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'students_year_of_study_range_check'
    ) THEN
        ALTER TABLE public.students
        ADD CONSTRAINT students_year_of_study_range_check
        CHECK (year_of_study IS NULL OR (year_of_study >= 1 AND year_of_study <= 6));
    END IF;
END $$;

-- Helpful index for tenant search by roll number
CREATE INDEX IF NOT EXISTS idx_students_roll_number ON public.students (roll_number);
