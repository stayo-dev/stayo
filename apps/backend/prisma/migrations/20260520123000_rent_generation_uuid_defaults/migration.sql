-- Ensure rent generation audit tables can create IDs from both Prisma and SQL.
-- Existing rows are untouched; this only adds DB-side defaults.

ALTER TABLE public.rent_generation_logs
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.rent_generation_ledgers
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
