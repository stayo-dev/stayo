-- ============================================================
-- HMS: Apply all pending migrations via Supabase SQL Editor
-- All statements are fully idempotent — safe to re-run.
-- Run the ENTIRE script at once.
-- ============================================================

-- ── SAFETY NET: Drop XOR constraint if still present ────────
-- (add_payment_attempt_obligations migration may not have run)
-- ADVANCE payments have neither obligation_id nor invoice_id,
-- so the constraint must be gone before advance payments work.
ALTER TABLE payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_obligation_invoice_xor_check;

-- ============================================================
-- MIGRATION: 20260503000000_advance_ledger_dob
-- ============================================================

-- 1. Enums (guarded against duplicate)
DO $$ BEGIN
  CREATE TYPE "AdvanceLedgerType" AS ENUM ('CREDIT', 'DEBIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdvanceLedgerReason" AS ENUM ('DEPOSIT', 'TOPUP', 'ADJUSTMENT', 'DEDUCTION', 'REFUND', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. date_of_birth column on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- 3. TenantAdvanceLedger table
CREATE TABLE IF NOT EXISTS tenant_advance_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  owner_id       UUID NOT NULL,
  type           "AdvanceLedgerType" NOT NULL,
  reason         "AdvanceLedgerReason" NOT NULL,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  balance_after  NUMERIC(10,2) NOT NULL CHECK (balance_after >= 0),
  notes          TEXT,
  reference_id   UUID,
  reference_type TEXT,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tal_tenant_id ON tenant_advance_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tal_owner_id  ON tenant_advance_ledger(owner_id);
CREATE INDEX IF NOT EXISTS idx_tal_tenant_ts ON tenant_advance_ledger(tenant_id, created_at);

-- ============================================================
-- MIGRATION: 20260503120000_advance_payment_type_idempotency
-- ============================================================

-- 4. payment_type on payment_attempts
ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'RENT';

-- 5. refund_status on tenant_advance_ledger
ALTER TABLE tenant_advance_ledger
  ADD COLUMN IF NOT EXISTS refund_status TEXT;

-- 6. Partial unique index — idempotency guard for webhook retries.
--    Prevents duplicate CREDIT/DEBIT for the same source record.
--    NULL reference_id rows are excluded (manual entries not constrained).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tal_ref_idempotency
  ON tenant_advance_ledger(reference_id, reference_type)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- Mark these migrations as applied in Prisma's tracking table
-- so `prisma migrate status` stays in sync.
-- ============================================================
INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260503000000_advance_ledger_dob', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260503000000_advance_ledger_dob'
);

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260503120000_advance_payment_type_idempotency', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260503120000_advance_payment_type_idempotency'
);

-- ============================================================
-- MIGRATION: 20260506193000_active_allocation_unique
-- ============================================================

-- Enforce one ACTIVE allocation per tenant while preserving historical records.
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_allocations_active_tenant_unique
  ON public.room_allocations (tenant_id)
  WHERE is_active = true AND end_date IS NULL;

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260506193000_active_allocation_unique', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260506193000_active_allocation_unique'
);

-- ============================================================
-- MIGRATION: 20260506202000_rent_obligations_owner_month_idx
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_rent_obligations_owner_month
  ON public.rent_obligations (owner_id, rent_month);

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260506202000_rent_obligations_owner_month_idx', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260506202000_rent_obligations_owner_month_idx'
);

-- ============================================================
-- MIGRATION: 20260506213000_owner_dashboard_snapshots
-- ============================================================

CREATE TABLE IF NOT EXISTS public.owner_dashboard_snapshots (
  owner_id             UUID PRIMARY KEY,
  snapshot_month       DATE NOT NULL,
  tenant_count         INTEGER NOT NULL DEFAULT 0,
  active_tenant_count  INTEGER NOT NULL DEFAULT 0,
  total_room_count     INTEGER NOT NULL DEFAULT 0,
  total_capacity       INTEGER NOT NULL DEFAULT 0,
  vacant_beds          INTEGER NOT NULL DEFAULT 0,
  occupancy_rate       INTEGER NOT NULL DEFAULT 0,
  rent_collected_month NUMERIC(12,2) NOT NULL DEFAULT 0,
  expenses_month       NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_dues         NUMERIC(12,2) NOT NULL DEFAULT 0,
  overdue_total        NUMERIC(12,2) NOT NULL DEFAULT 0,
  overdue_count        INTEGER NOT NULL DEFAULT 0,
  collection_rate      INTEGER NOT NULL DEFAULT 0,
  monthly_trend        JSONB,
  monthly_trend_months INTEGER NOT NULL DEFAULT 6,
  stats_computed_at    TIMESTAMPTZ,
  monthly_computed_at  TIMESTAMPTZ,
  is_stale             BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_dashboard_snapshots_is_stale
  ON public.owner_dashboard_snapshots(is_stale);
CREATE INDEX IF NOT EXISTS idx_owner_dashboard_snapshots_stats_computed_at
  ON public.owner_dashboard_snapshots(stats_computed_at);
CREATE INDEX IF NOT EXISTS idx_owner_dashboard_snapshots_monthly_computed_at
  ON public.owner_dashboard_snapshots(monthly_computed_at);

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260506213000_owner_dashboard_snapshots', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260506213000_owner_dashboard_snapshots'
);

-- ============================================================
-- MIGRATION: 20260509120000_rent_generation_ledger
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rent_generation_ledgers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL,
  hostel_id       UUID NOT NULL,
  rent_month      DATE NOT NULL,
  obligation_type TEXT NOT NULL,
  status          TEXT NOT NULL,
  trigger_type    TEXT,
  generated_by    UUID,
  created_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  failure_reason  TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT rent_generation_ledgers_status_check
    CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED', 'SKIPPED')),
  CONSTRAINT rent_generation_ledgers_scope_key
    UNIQUE (owner_id, hostel_id, rent_month, obligation_type)
);

CREATE INDEX IF NOT EXISTS idx_rent_generation_ledgers_month_status
  ON public.rent_generation_ledgers (rent_month, status);

CREATE INDEX IF NOT EXISTS idx_rent_generation_ledgers_owner_month
  ON public.rent_generation_ledgers (owner_id, rent_month);

CREATE INDEX IF NOT EXISTS idx_rent_generation_ledgers_hostel_month
  ON public.rent_generation_ledgers (hostel_id, rent_month);

INSERT INTO public.rent_generation_ledgers (
  owner_id, hostel_id, rent_month, obligation_type, status, trigger_type,
  created_count, skipped_count, started_at, completed_at, created_at, updated_at
)
SELECT
  o.owner_id,
  r.hostel_id,
  o.rent_month,
  COALESCE(o.obligation_type, 'RENT') AS obligation_type,
  'COMPLETED' AS status,
  'backfill' AS trigger_type,
  COUNT(*)::INTEGER AS created_count,
  0 AS skipped_count,
  MIN(o.created_at) AS started_at,
  MAX(o.created_at) AS completed_at,
  NOW() AS created_at,
  NOW() AS updated_at
FROM public.rent_obligations o
JOIN public.room_allocations ra ON ra.id = o.allocation_id
JOIN public.rooms r ON r.id = ra.room_id
WHERE o.owner_id IS NOT NULL
  AND o.allocation_id IS NOT NULL
  AND r.hostel_id IS NOT NULL
GROUP BY o.owner_id, r.hostel_id, o.rent_month, COALESCE(o.obligation_type, 'RENT')
ON CONFLICT (owner_id, hostel_id, rent_month, obligation_type) DO NOTHING;

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260509120000_rent_generation_ledger', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260509120000_rent_generation_ledger'
);

-- ============================================================
-- MIGRATION: 20260728000000_profile_auth_user_id (ADR-031, Supabase Auth migration)
-- ============================================================

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "auth_user_id" UUID;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "auth_linked_at" TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_auth_user_id_key" ON "profiles"("auth_user_id");
DROP TABLE IF EXISTS "token_blacklist";

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260728000000_profile_auth_user_id', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260728000000_profile_auth_user_id'
);

-- ============================================================
-- MIGRATION: 20260729000000_platform_leads_google_email (real Google-auth lead capture)
-- ============================================================

ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "google_email" TEXT;

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260729000000_platform_leads_google_email', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260729000000_platform_leads_google_email'
);

-- ============================================================
-- MIGRATION: 20260729010000_platform_lead_invitations_and_status_lifecycle
-- (owner acquisition funnel, phase 2)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PlatformLeadStatus' AND e.enumlabel = 'UNDER_REVIEW'
  ) THEN
    CREATE TYPE "PlatformLeadStatus_new" AS ENUM (
      'NEW', 'UNDER_REVIEW', 'APPROVED', 'INVITE_SENT',
      'OWNER_ACTIVATED', 'HOSTEL_CREATED', 'LIVE', 'LOST'
    );

    ALTER TABLE "platform_leads" ALTER COLUMN "status" DROP DEFAULT;

    ALTER TABLE "platform_leads"
      ALTER COLUMN "status" TYPE "PlatformLeadStatus_new"
      USING (
        CASE status::text
          WHEN 'CONTACTED' THEN 'APPROVED'
          WHEN 'DEMO_SCHEDULED' THEN 'UNDER_REVIEW'
          WHEN 'ONBOARDING' THEN 'INVITE_SENT'
          WHEN 'ACTIVE' THEN 'LIVE'
          WHEN 'NEW' THEN 'NEW'
          WHEN 'LOST' THEN 'LOST'
          ELSE 'NEW'
        END
      )::"PlatformLeadStatus_new"
    ;

    ALTER TABLE "platform_leads" ALTER COLUMN "status" SET DEFAULT 'NEW'::"PlatformLeadStatus_new";

    DROP TYPE "PlatformLeadStatus";
    ALTER TYPE "PlatformLeadStatus_new" RENAME TO "PlatformLeadStatus";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "platform_lead_invitations" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lead_id"    UUID NOT NULL,
  "token"      TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_lead_invitations_token_key" ON "platform_lead_invitations"("token");
CREATE INDEX IF NOT EXISTS "platform_lead_invitations_lead_id_idx" ON "platform_lead_invitations"("lead_id");

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260729010000_platform_lead_invitations_and_status_lifecycle', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260729010000_platform_lead_invitations_and_status_lifecycle'
);

-- ============================================================
-- MIGRATION: 20260519000000_floor_entity_room_fields
-- ============================================================

CREATE TABLE IF NOT EXISTS floors (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hostel_id  UUID        NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  owner_id   UUID        NOT NULL,
  name       TEXT        NOT NULL,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guard against floors existing without sort_order
ALTER TABLE floors ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS floors_hostel_id_idx ON floors(hostel_id);
CREATE INDEX IF NOT EXISTS floors_owner_id_idx  ON floors(owner_id);

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS floor_id      UUID REFERENCES floors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wifi_name     TEXT,
  ADD COLUMN IF NOT EXISTS wifi_password TEXT,
  ADD COLUMN IF NOT EXISTS notes         TEXT;

CREATE INDEX IF NOT EXISTS rooms_floor_id_idx ON rooms(floor_id);

INSERT INTO floors (id, hostel_id, owner_id, name, sort_order)
SELECT
  gen_random_uuid(),
  r.hostel_id,
  h.owner_id,
  CASE COALESCE(r.floor, 0)
    WHEN 0 THEN 'Ground Floor'
    WHEN 1 THEN '1st Floor'
    WHEN 2 THEN '2nd Floor'
    WHEN 3 THEN '3rd Floor'
    WHEN 4 THEN '4th Floor'
    WHEN 5 THEN '5th Floor'
    ELSE COALESCE(r.floor, 0)::TEXT || 'th Floor'
  END,
  COALESCE(r.floor, 0)
FROM (
  SELECT DISTINCT hostel_id, floor FROM rooms WHERE is_active = TRUE
) r
JOIN hostels h ON h.id = r.hostel_id
ON CONFLICT DO NOTHING;

UPDATE rooms r
SET    floor_id = f.id
FROM   floors f
WHERE  f.hostel_id  = r.hostel_id
  AND  f.sort_order = COALESCE(r.floor, 0)
  AND  r.floor_id   IS NULL
  AND  r.is_active  = TRUE;

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid(), 'manual_apply', NOW(),
  '20260519000000_floor_entity_room_fields', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations"
  WHERE migration_name = '20260519000000_floor_entity_room_fields'
);

