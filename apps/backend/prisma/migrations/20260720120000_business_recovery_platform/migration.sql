-- Business Recovery Platform: correction_cases + correction_case_events
-- Additive only; no existing tables modified.
-- See docs/business-logic/business-recovery-platform-architecture.md

-- Made idempotent 2026-08-15 while resolving a stuck `migrate deploy`: this
-- database already had these three enums (values confirmed matching
-- exactly against information_schema before editing).
DO $$ BEGIN
  CREATE TYPE "RecoveryTier" AS ENUM ('OPERATIONAL_UNDO', 'FINANCIAL_CORRECTION', 'ADMINISTRATIVE_REVERSAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "CorrectionDomain" AS ENUM ('PAYMENTS', 'ROOMS', 'AGREEMENTS', 'EXPENSES', 'ADMISSIONS', 'RENEWALS', 'SETTINGS', 'DOCUMENTS', 'KYC', 'RESERVATIONS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'PREVIEW', 'VALIDATED', 'EXECUTING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "correction_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hostel_id" UUID NOT NULL,
  "domain" "CorrectionDomain" NOT NULL,
  "case_type" TEXT NOT NULL,
  "tier" "RecoveryTier" NOT NULL,
  "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
  "entity_refs" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "actor_id" UUID NOT NULL,
  "actor_role" TEXT NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "preview_impact" JSONB,
  "execution_result" JSONB,
  "case_detail" JSONB NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "depends_on" TEXT[] NOT NULL DEFAULT '{}',
  "undo_expires_at" TIMESTAMPTZ(6),
  "correlation_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6),
  CONSTRAINT "correction_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "correction_cases_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "correction_cases_idempotency_key_key" ON "correction_cases"("idempotency_key");
CREATE INDEX IF NOT EXISTS "correction_cases_hostel_id_idx" ON "correction_cases"("hostel_id");
CREATE INDEX IF NOT EXISTS "correction_cases_hostel_id_status_idx" ON "correction_cases"("hostel_id", "status");
CREATE INDEX IF NOT EXISTS "correction_cases_status_undo_expires_at_idx" ON "correction_cases"("status", "undo_expires_at");
CREATE INDEX IF NOT EXISTS "correction_cases_case_type_idx" ON "correction_cases"("case_type");

CREATE TABLE IF NOT EXISTS "correction_case_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "correction_case_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_id" UUID NOT NULL,
  "actor_role" TEXT NOT NULL,
  "reason" TEXT,
  "snapshot" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "correction_case_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "correction_case_events_case_id_fkey" FOREIGN KEY ("correction_case_id") REFERENCES "correction_cases"("id")
);

CREATE INDEX IF NOT EXISTS "correction_case_events_case_id_idx" ON "correction_case_events"("correction_case_id");
