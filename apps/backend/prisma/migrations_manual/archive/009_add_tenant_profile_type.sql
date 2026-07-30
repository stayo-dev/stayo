BEGIN;

ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS profile_type TEXT;

UPDATE public.tenants
SET profile_type = 'STUDENT'
WHERE profile_type IS NULL OR btrim(profile_type) = '';

ALTER TABLE public.tenants
ALTER COLUMN profile_type SET DEFAULT 'STUDENT';

ALTER TABLE public.tenants
ALTER COLUMN profile_type SET NOT NULL;

COMMIT;
