-- Add completion flag to students as the canonical onboarding state
ALTER TABLE IF EXISTS public.students
ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill from profiles where available
UPDATE public.students s
SET profile_completed = TRUE
FROM public.profiles p
WHERE p.id = s.profile_id
  AND COALESCE(p.is_profile_completed, FALSE) = TRUE;
