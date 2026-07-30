ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS mobile_verified boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS mobile_verified boolean NOT NULL DEFAULT false;
