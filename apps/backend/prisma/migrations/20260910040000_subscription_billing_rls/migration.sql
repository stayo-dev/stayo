-- Phase 6.9 — enable RLS on the 4 owner-level subscription billing tables
-- that were left disabled since ADR-172 Phase 1 (owner_subscriptions,
-- subscription_payments, subscription_invoices, owner_billing_profiles).
--
-- WHY THIS IS SAFE (traced before writing this migration, not assumed):
--   - The backend NEVER queries these tables as `anon`/`authenticated` — it
--     connects via `DATABASE_URL`'s `postgres.<project>` pooled superuser
--     role (lib/db.ts `prisma`) and, separately, via the Supabase
--     `SUPABASE_SERVICE_ROLE_KEY` client (lib/db.ts `supabase`). BOTH of
--     those roles implicitly bypass RLS in Postgres/Supabase — enabling RLS
--     here changes nothing about how the backend itself reads or writes
--     these tables.
--   - The frontend never queries these tables directly via a Supabase client
--     (`grep -rn "supabase.from(" apps/frontend/src` — zero hits touching
--     these table names). Every owner/admin read and write goes through the
--     Next.js API routes in `app/api/{owner,platform-admin}/subscription*`,
--     which use the backend's Prisma/service-role connection above.
--   - Therefore the ONLY effect of turning RLS on is closing a real,
--     currently-open exposure: anyone holding the public Supabase `anon` key
--     (trivially extracted from any deployed frontend bundle) could today
--     query e.g. `GET .../rest/v1/owner_subscriptions?select=*` directly via
--     PostgREST and read (or, since RLS-off also leaves writes unguarded,
--     write) every owner's billing row, bypassing the app's authorization
--     entirely. This migration closes that without touching how the
--     application itself behaves.
--
-- Policy shape: authenticated users get READ-ONLY access, scoped to their
-- own rows (resolved via `profiles.auth_user_id = auth.uid()`, NOT
-- `owner_id = auth.uid()` directly — `profiles.id` and the Supabase auth
-- user id are DELIBERATELY different columns, see docs/obsidian/Database.md
-- "Auth/session model"). Admins (`profiles.role = 'ADMIN'`) get read access
-- to every row, matching what the admin API surface already exposes. NO
-- INSERT/UPDATE/DELETE policy is created for `anon` or `authenticated` on
-- any of the four tables — every write in this domain happens through the
-- backend's RLS-bypassing connection, so there is no legitimate
-- authenticated-role write path to grant, and granting none is the safer
-- default (a missing SELECT policy just means "no rows returned"; a missing
-- write policy the same way means "operation denied" — neither can silently
-- corrupt data).
--
-- Idempotent (DROP POLICY IF EXISTS before each CREATE), non-destructive
-- (touches no data, no columns). Reversible via down.sql.

ALTER TABLE "owner_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "owner_billing_profiles" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_subscriptions_select_own_or_admin" ON "owner_subscriptions";
CREATE POLICY "owner_subscriptions_select_own_or_admin" ON "owner_subscriptions"
  FOR SELECT
  USING (
    owner_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'ADMIN')
  );

DROP POLICY IF EXISTS "subscription_payments_select_own_or_admin" ON "subscription_payments";
CREATE POLICY "subscription_payments_select_own_or_admin" ON "subscription_payments"
  FOR SELECT
  USING (
    owner_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'ADMIN')
  );

DROP POLICY IF EXISTS "subscription_invoices_select_own_or_admin" ON "subscription_invoices";
CREATE POLICY "subscription_invoices_select_own_or_admin" ON "subscription_invoices"
  FOR SELECT
  USING (
    owner_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'ADMIN')
  );

DROP POLICY IF EXISTS "owner_billing_profiles_select_own_or_admin" ON "owner_billing_profiles";
CREATE POLICY "owner_billing_profiles_select_own_or_admin" ON "owner_billing_profiles"
  FOR SELECT
  USING (
    owner_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'ADMIN')
  );
