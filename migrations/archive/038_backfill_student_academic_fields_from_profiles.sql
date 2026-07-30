-- Backfill newly added student academic fields from legacy profile columns
-- for tenants who completed onboarding before unified contract rollout.

UPDATE public.students s
SET
    roll_number = COALESCE(s.roll_number, p.college_roll_number),
    year_of_study = COALESCE(
        s.year_of_study,
        CASE
            WHEN p.year_of_study ~ '^[0-9]+$' THEN (p.year_of_study)::INTEGER
            ELSE NULL
        END
    ),
    section = COALESCE(s.section, p.section),
    branch = COALESCE(s.branch, p.branch)
FROM public.profiles p
WHERE p.id = s.profile_id
  AND (
    s.roll_number IS NULL
    OR s.year_of_study IS NULL
    OR s.section IS NULL
    OR s.branch IS NULL
  );
