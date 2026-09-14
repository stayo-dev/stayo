-- Verify that the two backend-only tables locked down by
-- 20260916000000_otp_tables_rls_lockdown are unreachable by the public
-- PostgREST roles. Run this against any environment AFTER the migration has
-- been applied — e.g. in the Supabase SQL editor, or:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-otp-rls.sql
--
-- It proves that `anon` (and `authenticated`) can neither SELECT, INSERT,
-- UPDATE nor DELETE `email_verification_otps` or `_prisma_migrations`. It is
-- non-destructive: every write is attempted inside a DO block that always
-- aborts, so nothing it does can persist. On success it RAISEs a
-- 'C3_VERIFY_RESULT=PASS' exception (SQLSTATE P0001); on failure the message
-- lists exactly what is still reachable. Both outcomes leave the DB unchanged.

DO $$
DECLARE
  failures text[] := '{}';
  role_name text;
  tbl text;
  ok boolean;
BEGIN
  -- Grants: neither public role may hold any privilege on either table.
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH tbl IN ARRAY ARRAY['public.email_verification_otps','public._prisma_migrations'] LOOP
      IF has_table_privilege(role_name, tbl, 'SELECT') THEN failures := failures || (role_name||' has SELECT on '||tbl); END IF;
      IF has_table_privilege(role_name, tbl, 'INSERT') THEN failures := failures || (role_name||' has INSERT on '||tbl); END IF;
      IF has_table_privilege(role_name, tbl, 'UPDATE') THEN failures := failures || (role_name||' has UPDATE on '||tbl); END IF;
      IF has_table_privilege(role_name, tbl, 'DELETE') THEN failures := failures || (role_name||' has DELETE on '||tbl); END IF;
    END LOOP;
  END LOOP;

  -- RLS must be enabled on both (defence in depth behind the revoked grants).
  SELECT relrowsecurity INTO ok FROM pg_class WHERE oid = 'public.email_verification_otps'::regclass;
  IF NOT ok THEN failures := failures || 'RLS not enabled on email_verification_otps'; END IF;
  SELECT relrowsecurity INTO ok FROM pg_class WHERE oid = 'public._prisma_migrations'::regclass;
  IF NOT ok THEN failures := failures || 'RLS not enabled on _prisma_migrations'; END IF;

  -- Act as anon: every operation must raise insufficient_privilege.
  SET LOCAL ROLE anon;

  BEGIN PERFORM 1 FROM public.email_verification_otps LIMIT 1;
        failures := failures || 'anon SELECT succeeded on email_verification_otps';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN failures := failures || ('anon SELECT otps not privilege-denied: '||SQLSTATE); END;

  BEGIN EXECUTE 'INSERT INTO public.email_verification_otps DEFAULT VALUES';
        failures := failures || 'anon INSERT succeeded on email_verification_otps';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN failures := failures || ('anon INSERT otps not privilege-denied: '||SQLSTATE); END;

  BEGIN EXECUTE 'UPDATE public.email_verification_otps SET attempts = 0';
        failures := failures || 'anon UPDATE succeeded on email_verification_otps';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN failures := failures || ('anon UPDATE otps not privilege-denied: '||SQLSTATE); END;

  BEGIN EXECUTE 'DELETE FROM public.email_verification_otps';
        failures := failures || 'anon DELETE succeeded on email_verification_otps';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN failures := failures || ('anon DELETE otps not privilege-denied: '||SQLSTATE); END;

  BEGIN PERFORM 1 FROM public._prisma_migrations LIMIT 1;
        failures := failures || 'anon SELECT succeeded on _prisma_migrations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN failures := failures || ('anon SELECT migrations not privilege-denied: '||SQLSTATE); END;

  BEGIN EXECUTE 'DELETE FROM public._prisma_migrations';
        failures := failures || 'anon DELETE succeeded on _prisma_migrations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN failures := failures || ('anon DELETE migrations not privilege-denied: '||SQLSTATE); END;

  RESET ROLE;

  -- Always abort, so the attempted writes above can never persist. The verdict
  -- rides the exception message.
  IF array_length(failures, 1) > 0 THEN
    RAISE EXCEPTION 'C3_VERIFY_RESULT=FAIL :: %', array_to_string(failures, ' | ');
  ELSE
    RAISE EXCEPTION 'C3_VERIFY_RESULT=PASS :: anon/authenticated denied SELECT/INSERT/UPDATE/DELETE on both tables; RLS enabled on both';
  END IF;
END $$;
