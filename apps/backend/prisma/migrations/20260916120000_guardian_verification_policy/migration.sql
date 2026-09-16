-- ADR-212 — guardian verification becomes a hostel policy, and a deferral is a
-- dated promise.
--
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT DECLARES THESE COLUMNS.
--
-- Prisma requests every declared scalar column on any read that passes no
-- explicit `select`, and both tables below are read that way in this codebase.
-- Declaring a field and deploying ahead of its migration is what 500'd every
-- public listing page on 2026-08-22 (`hostels.navigation`). Order matters here
-- in exactly the same way.
--
-- Written idempotently so a re-run is harmless, and applied by hand via psql or
-- the Supabase SQL editor — `prisma migrate deploy` is unusable against this
-- project, whose `_prisma_migrations` history was never populated.

-- ── 1. Deferral state on the tenancy ────────────────────────────────────────
-- Verification *proof* deliberately stays in the phone_verification_otps audit
-- trail (see guardian-access.ts) — there is no guardian_verified boolean here,
-- because a second source of truth is a second thing to keep in sync. What the
-- trail cannot hold is the promise a tenant made when they deferred, which is
-- what these three columns are.

ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "guardian_verification_deferred_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "guardian_verification_deferred_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "guardian_verification_next_prompt_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "guardian_verification_prompt_count" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "public"."tenants"."guardian_verification_deferred_at" IS
  'ADR-212. When the tenant chose to verify their guardian later. Starts the 7-day grace clock in a MANDATORY hostel. NULL means never deferred, which is not the same as verified.';
COMMENT ON COLUMN "public"."tenants"."guardian_verification_deferred_reason" IS
  'ADR-212. One of NOT_REACHABLE_NOW | TRAVELLING | NO_WHATSAPP | PREFER_NOT_TO. A fixed set rather than free text so an owner can act on it.';
COMMENT ON COLUMN "public"."tenants"."guardian_verification_next_prompt_at" IS
  'ADR-212. When to ask again: deferred_at + 7 days on the first deferral, pushed forward 3 days by each dismissal. The wall backs off by date, not by a counter.';
COMMENT ON COLUMN "public"."tenants"."guardian_verification_prompt_count" IS
  'ADR-212. How many times the tenant has dismissed the overdue wall. Reporting only — it does not gate the prompt.';

-- ── 2. Scope a verification to the tenancy it was taken for ─────────────────
-- The onboarding check was `{ phone, purpose: 'ParentVerify', status: 'VERIFIED' }`
-- with no tenant link and no time window, so any number ever verified for any
-- tenant read as verified for every tenant, forever. Tolerable while everyone
-- passed the gate on the spot; not tolerable now that the product renders a
-- "Verified" badge an owner makes decisions from.
--
-- Deliberately NOT backfilled: there is no reliable way to attribute a
-- historical OTP row to a tenancy, so pre-existing rows keep tenant_id NULL and
-- are accepted as legacy by the read path. Guessing would manufacture exactly
-- the false confidence this column exists to remove.
--
-- ON DELETE SET NULL, not CASCADE: the OTP trail is an audit record of what was
-- sent to a real handset. Deleting a tenancy must not erase the evidence.

ALTER TABLE "public"."phone_verification_otps"
  ADD COLUMN IF NOT EXISTS "tenant_id" UUID;

COMMENT ON COLUMN "public"."phone_verification_otps"."tenant_id" IS
  'ADR-212. Which tenancy this verification was taken for. NULL on rows predating ADR-212, which the read path accepts as legacy. Set going forward so a ParentVerify proof cannot be borrowed by a different tenant.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'phone_verification_otps_tenant_id_fkey'
  ) THEN
    ALTER TABLE "public"."phone_verification_otps"
      ADD CONSTRAINT "phone_verification_otps_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- The read path's hot query is (tenant_id, purpose, status). Deliberately not a
-- partial index on `tenant_id IS NOT NULL`, even though that is where every
-- lookup lands: Prisma cannot express a partial index, so declaring one here
-- would leave schema.prisma permanently out of step with the database it
-- describes. The legacy NULL rows stop growing the moment this ships.
CREATE INDEX IF NOT EXISTS "phone_verification_otps_tenant_id_purpose_idx"
  ON "public"."phone_verification_otps" ("tenant_id", "purpose", "status");
