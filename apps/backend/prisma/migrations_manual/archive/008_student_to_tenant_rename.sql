BEGIN;

-- 1) Core table rename
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'students'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) THEN
    EXECUTE 'ALTER TABLE public.students RENAME TO tenants';
  END IF;
END $$;

-- 2) Rename legacy student_id -> tenant_id across dependent tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'room_allocations',
    'rent_obligations',
    'payments',
    'payment_attempts',
    'identification_documents',
    'reactivation_requests',
    'complaints',
    'receipts',
    'reminder_logs',
    'system_event_logs'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'student_id'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'tenant_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I RENAME COLUMN student_id TO tenant_id',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- 3) Rename common primary key/index names if still legacy
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'students_pkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'tenants_pkey'
  ) THEN
    EXECUTE 'ALTER INDEX public.students_pkey RENAME TO tenants_pkey';
  END IF;
END $$;

COMMIT;
