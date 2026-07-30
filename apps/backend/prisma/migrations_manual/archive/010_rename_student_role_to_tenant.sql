BEGIN;

-- 1. Add TENANT to the existing Role enum
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'TENANT';

COMMIT;

-- 2. Migrate existing STUDENT rows to TENANT (must be outside transaction for new enum value)
UPDATE public.profiles SET role = 'TENANT' WHERE role = 'STUDENT';
