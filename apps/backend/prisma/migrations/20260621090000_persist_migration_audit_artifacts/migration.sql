-- Migration audit artifacts must survive serverless invocations. Store the full
-- JSON artifact beside the indexed summary instead of writing to /var/task.
ALTER TABLE public.migration_audit_runs
  ADD COLUMN IF NOT EXISTS artifact JSONB;
