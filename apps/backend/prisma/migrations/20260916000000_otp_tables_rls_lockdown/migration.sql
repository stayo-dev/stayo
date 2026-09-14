-- Lock down two PostgREST-exposed, backend-only tables that shipped world-
-- accessible: `email_verification_otps` and `_prisma_migrations`.
-- C3 of the 2026-09-14 authentication/authorization security audit.
--
-- CURRENT STATE (production qgfyfbdccjnibdhhvnsr, measured 2026-09-14): both
-- tables have RLS OFF and grant `anon` + `authenticated` full
-- SELECT/INSERT/UPDATE/DELETE. With the public Supabase anon key — extractable
-- from any deployed frontend bundle — anyone could, straight through PostgREST:
--   - INSERT an `email_verification_otps` row with status = 'VERIFIED' for any
--     address, defeating the onboarding email-ownership proof (ADR-183);
--   - UPDATE `attempts` back to 0 to brute-force a live 6-digit code;
--   - SELECT every pending onboarding email + request IP;
--   - DELETE `_prisma_migrations` rows so the next deploy re-runs migrations.
--
-- WHY DENY-ALL IS CORRECT (traced, not assumed):
--   - `email_verification_otps` is written and read ONLY by
--     lib/services/auth/email-otp-service.ts via Prisma
--     (`prisma.emailVerificationOtp.*`), over the `DATABASE_URL` `postgres`
--     connection in lib/db.ts. No frontend Supabase client touches it
--     (`grep -rn "email_verification" apps/frontend/src` — none).
--   - `_prisma_migrations` is Prisma's own bookkeeping, touched only by the
--     migration engine over that same superuser connection.
--   - Both `postgres` (the table owner) and Supabase `service_role`
--     (BYPASSRLS) ignore RLS, so enabling it changes nothing for the backend.
--     Neither table has any legitimate anon/authenticated caller, so NO policy
--     is created — deny-all is the entire intent.
--
-- DEFENCE IN DEPTH: RLS on (denies row access to non-bypass roles) AND the
-- anon/authenticated grants revoked (so PostgREST drops the tables from its
-- exposed schema altogether). Either alone closes the hole; both leave no gap.
-- `service_role` and `postgres` grants are deliberately left intact.
--
-- Idempotent (ENABLE RLS and REVOKE are both safe to re-run) and
-- non-destructive (touches no rows or columns). Reversible via down.sql, which
-- restores the pre-fix grants — i.e. rolls back to a KNOWN-INSECURE state, and
-- exists only for operational completeness.

ALTER TABLE "email_verification_otps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations"      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "email_verification_otps" FROM anon, authenticated;
REVOKE ALL ON TABLE "_prisma_migrations"      FROM anon, authenticated;
