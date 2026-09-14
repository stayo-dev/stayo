-- Rollback for 20260916000000_otp_tables_rls_lockdown.
--
-- ⚠️ This RESTORES A KNOWN-INSECURE STATE: it re-grants the public `anon` and
-- `authenticated` roles full access to `email_verification_otps` and
-- `_prisma_migrations` and disables RLS. It exists only so the migration is
-- formally reversible. Do NOT run it except to reproduce the pre-fix state in
-- a throwaway environment.

ALTER TABLE "email_verification_otps" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations"      DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "email_verification_otps" TO anon, authenticated;
GRANT ALL ON TABLE "_prisma_migrations"      TO anon, authenticated;
