-- 094_stay_guardian_consent.sql
--
-- ADR-234 — a guardian is told when their ward leaves the hostel and when
-- they get back, once the tenant has agreed to it.
--
-- APPLY THIS *AFTER* DEPLOYING THE CODE THAT DECLARES THE MODEL.
--
-- That is the opposite of the usual order here, and it is safe only because
-- this table is additive: no existing query reads it, and with no rows the
-- notify policy returns NO_CONSENT and nothing sends. The usual rule (migrate
-- first) exists because Prisma selects every declared scalar column on a read
-- with no explicit `select`, so a column declared ahead of its migration 500s
-- every query against that table — which is what took production down on
-- 2026-08-14 via `tenants`. A brand-new table has no such reader, so the
-- deploy is inert until this runs.
--
-- Deliberately NOT columns on `tenants`: getSession() reads that table with no
-- explicit select on every authenticated request, for every role, so a
-- declared-but-missing column there 500s the entire authenticated API rather
-- than one screen.
--
-- Applied by hand via psql or the Supabase SQL editor — `prisma migrate
-- deploy` is unusable against this project, whose `_prisma_migrations` history
-- was never populated. Safe to re-run.

CREATE TABLE IF NOT EXISTS "public"."stay_guardian_consent" (
  "tenant_id"      UUID PRIMARY KEY,
  "hostel_id"      UUID NOT NULL,
  "granted"        BOOLEAN NOT NULL,
  "guardian_phone" TEXT NOT NULL,
  "decided_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "revoked_at"     TIMESTAMPTZ(6),
  "stopped_at"     TIMESTAMPTZ(6),
  "source"         TEXT NOT NULL,
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "public"."stay_guardian_consent" IS
  'ADR-234. One row per tenancy: whether the tenant agreed to have their guardian told when they leave and return. A granted=false row is the memory of HAVING ASKED, which is what stops the sheet reappearing on every trip.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."guardian_phone" IS
  'ADR-234. The guardian number consented to, snapshotted. Consent was given to tell a person, not a field: if tenants.guardian_phone later differs, the decision is about somebody else and the tenant is asked again.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."revoked_at" IS
  'ADR-234. The TENANT switched it off. Distinct from stopped_at on purpose.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."stopped_at" IS
  'ADR-234. The GUARDIAN replied STOP. Outranks a later re-grant by the tenant - someone who asked to be left alone must not be silently re-subscribed.';
COMMENT ON COLUMN "public"."stay_guardian_consent"."source" IS
  'ADR-234. APP or QR - where the tenant was standing when asked.';

-- The sweep's only filter: live consents, so events belonging to tenants who
-- never consented are never loaded.
CREATE INDEX IF NOT EXISTS "stay_guardian_consent_live_idx"
  ON "public"."stay_guardian_consent" ("hostel_id")
  WHERE "granted" AND "revoked_at" IS NULL AND "stopped_at" IS NULL;

-- ── Lockdown ────────────────────────────────────────────────────────────────
-- VITE_SUPABASE_ANON_KEY is compiled into the browser bundle and is public by
-- construction. This table records which residents are being reported on and
-- to which phone number; it must not be the sixth table reachable with it.
-- No policies, deliberately: the backend connects as the owning role and
-- bypasses RLS, so enabling it with no policy is a clean lockout of the anon
-- key, not a change to how the application reads its own data.
ALTER TABLE "public"."stay_guardian_consent" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."stay_guardian_consent" FROM anon;
REVOKE ALL ON TABLE "public"."stay_guardian_consent" FROM authenticated;
