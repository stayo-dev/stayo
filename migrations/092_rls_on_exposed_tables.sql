-- 092_rls_on_exposed_tables.sql
--
-- Turns Row Level Security on for every table that was created without it.
--
-- Why this is urgent rather than tidy: `VITE_SUPABASE_ANON_KEY` is a Vite
-- variable, so the Supabase anon key is compiled into the browser bundle and
-- is public by construction. No migration in this repo contains a REVOKE, so
-- PostgREST's default grants to `anon` and `authenticated` still stand. RLS
-- is therefore the only thing between that public key and these tables.
--
-- The worst of them is `manager_permission_grants`, a WRITABLE permissions
-- table: `requireManagerPermission` (manager-authorization.ts) gates the
-- admin console on rows in it, so inserting a grant against an existing
-- manager_profile_id is privilege escalation. `homepage_features` is
-- writable homepage defacement and `coverage_requests` holds visitor PII.
--
-- No policies are added, deliberately. Every legitimate read and write goes
-- through the backend, which connects via Prisma as the owning `postgres`
-- role and bypasses RLS. Enabling it with no policy is a clean lockout of
-- the anon key, not a change to how the application reads its own data.
--
-- Migrations 083, 089 and 090 already follow this convention; 085, 086, 088
-- and 091 omitted it. `tests/migration-rls.test.ts` now fails the build if a
-- new migration creates a table and leaves RLS off.
--
-- Apply via the Supabase SQL editor or psql. Safe to re-run — ALTER TABLE
-- ... ENABLE ROW LEVEL SECURITY is idempotent.

-- 085_manager_role.sql — platform staff accounts, their permissions, and
-- which hostels they may see.
ALTER TABLE "public"."manager_profiles"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."manager_permission_grants"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."manager_hostel_assignments" ENABLE ROW LEVEL SECURITY;

-- 086_coverage_requests.sql — visitor-submitted supply requests, with PII.
ALTER TABLE "public"."coverage_requests"          ENABLE ROW LEVEL SECURITY;

-- 088_homepage_features.sql — the curated homepage line-up.
ALTER TABLE "public"."homepage_features"          ENABLE ROW LEVEL SECURITY;

-- 091_marketplace_partners.sql — already enabled on the live database, but
-- not by that migration, so a fresh environment would come up exposed.
-- Stated here so re-running the pair from scratch is correct.
ALTER TABLE "public"."marketplace_partners"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."partner_listings"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."partner_lead_deliveries"    ENABLE ROW LEVEL SECURITY;
