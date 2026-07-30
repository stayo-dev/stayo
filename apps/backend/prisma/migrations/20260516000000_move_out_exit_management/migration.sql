-- Move-Out / Exit Management System
-- Adds workflow-driven exit lifecycle replacing primitive status = LEFT

-- 1. Add new enum values to TenantStatus
ALTER TYPE "public"."TenantStatus" ADD VALUE IF NOT EXISTS 'MOVE_OUT_REQUESTED';
ALTER TYPE "public"."TenantStatus" ADD VALUE IF NOT EXISTS 'SETTLEMENT_PENDING';

-- 2. Create MoveOutStatus enum
DO $$ BEGIN
  CREATE TYPE "public"."MoveOutStatus" AS ENUM (
    'REQUESTED',
    'UNDER_REVIEW',
    'AWAITING_SETTLEMENT',
    'APPROVED',
    'COMPLETED',
    'CANCELLED',
    'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Create MoveOutReason enum
DO $$ BEGIN
  CREATE TYPE "public"."MoveOutReason" AS ENUM (
    'COURSE_COMPLETED',
    'JOB_RELOCATION',
    'TOO_EXPENSIVE',
    'POOR_MAINTENANCE',
    'FOOD_QUALITY',
    'ROOMMATE_ISSUES',
    'BETTER_HOSTEL',
    'PERSONAL_REASONS',
    'SAFETY_CONCERNS',
    'RULES_TOO_STRICT',
    'MOVING_CLOSER',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Create move_out_requests table
CREATE TABLE IF NOT EXISTS "public"."move_out_requests" (
  "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"               UUID NOT NULL,
  "hostel_id"               UUID NOT NULL,
  "owner_id"                UUID NOT NULL,
  "status"                  "public"."MoveOutStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason"                  "public"."MoveOutReason" NOT NULL,
  "reason_text"             TEXT,
  "planned_exit_date"       DATE NOT NULL,
  "actual_exit_date"        DATE,
  "notice_period_days"      INTEGER NOT NULL DEFAULT 0,
  "notice_period_violation" BOOLEAN NOT NULL DEFAULT false,
  "initiated_by"            UUID NOT NULL,
  "initiated_by_role"       VARCHAR(20) NOT NULL DEFAULT 'TENANT',
  "reviewed_by"             UUID,
  "reviewed_at"             TIMESTAMPTZ(6),
  "review_notes"            TEXT,
  "cancelled_at"            TIMESTAMPTZ(6),
  "cancelled_by"            UUID,
  "cancellation_reason"     TEXT,
  "completed_at"            TIMESTAMPTZ(6),
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6),

  CONSTRAINT "move_out_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "move_out_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "move_out_requests_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "public"."hostels"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "udx_mor_tenant_active" ON "public"."move_out_requests"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_mor_hostel_status" ON "public"."move_out_requests"("hostel_id", "status");
CREATE INDEX IF NOT EXISTS "idx_mor_owner_status" ON "public"."move_out_requests"("owner_id", "status");
CREATE INDEX IF NOT EXISTS "idx_mor_planned_exit" ON "public"."move_out_requests"("planned_exit_date");
CREATE INDEX IF NOT EXISTS "idx_mor_status_created" ON "public"."move_out_requests"("status", "created_at" DESC);

-- 5. Create move_out_inspections table
CREATE TABLE IF NOT EXISTS "public"."move_out_inspections" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id"          UUID NOT NULL,
  "inspected_by"        UUID NOT NULL,
  "room_condition"      VARCHAR(20) NOT NULL DEFAULT 'GOOD',
  "cleaning_status"     VARCHAR(30) NOT NULL DEFAULT 'CLEAN',
  "inventory_checklist" JSONB,
  "damages_amount"      DECIMAL(10,2) NOT NULL DEFAULT 0,
  "cleaning_fee"        DECIMAL(10,2) NOT NULL DEFAULT 0,
  "missing_items_fee"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "other_deductions"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "deduction_notes"     TEXT,
  "evidence_urls"       TEXT[] DEFAULT '{}',
  "notes"               TEXT,
  "inspected_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6),

  CONSTRAINT "move_out_inspections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "move_out_inspections_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."move_out_requests"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "udx_moi_request" ON "public"."move_out_inspections"("request_id");
CREATE INDEX IF NOT EXISTS "idx_moi_inspected_at" ON "public"."move_out_inspections"("inspected_at");

-- 6. Create exit_settlement_transactions table
CREATE TABLE IF NOT EXISTS "public"."exit_settlement_transactions" (
  "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id"              UUID NOT NULL,
  "tenant_id"               UUID NOT NULL,
  "owner_id"                UUID NOT NULL,
  "hostel_id"               UUID NOT NULL,

  "security_deposit_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,

  "pending_rent_dues"       DECIMAL(10,2) NOT NULL DEFAULT 0,
  "pending_late_fees"       DECIMAL(10,2) NOT NULL DEFAULT 0,
  "pending_utility_dues"    DECIMAL(10,2) NOT NULL DEFAULT 0,

  "damages_deduction"       DECIMAL(10,2) NOT NULL DEFAULT 0,
  "cleaning_deduction"      DECIMAL(10,2) NOT NULL DEFAULT 0,
  "missing_items_deduction" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "other_deductions"        DECIMAL(10,2) NOT NULL DEFAULT 0,

  "total_deductions"        DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_dues"              DECIMAL(10,2) NOT NULL DEFAULT 0,

  "net_settlement_amount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "settlement_direction"    VARCHAR(20) NOT NULL DEFAULT 'NONE',

  "payment_status"          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "payment_method"          VARCHAR(30),
  "payment_reference"       TEXT,
  "payment_notes"           TEXT,
  "settled_at"              TIMESTAMPTZ(6),
  "settled_by"              UUID,
  "confirmed_by_tenant"     BOOLEAN NOT NULL DEFAULT false,
  "confirmed_by_owner"      BOOLEAN NOT NULL DEFAULT false,

  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6),

  CONSTRAINT "exit_settlement_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exit_settlement_transactions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."move_out_requests"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "udx_est_request" ON "public"."exit_settlement_transactions"("request_id");
CREATE INDEX IF NOT EXISTS "idx_est_tenant" ON "public"."exit_settlement_transactions"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_est_owner_hostel" ON "public"."exit_settlement_transactions"("owner_id", "hostel_id");
CREATE INDEX IF NOT EXISTS "idx_est_payment_status" ON "public"."exit_settlement_transactions"("payment_status");

-- 7. Create exit_feedbacks table
CREATE TABLE IF NOT EXISTS "public"."exit_feedbacks" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id"          UUID NOT NULL,
  "tenant_id"           UUID NOT NULL,
  "hostel_id"           UUID NOT NULL,

  "rating_cleanliness"  SMALLINT,
  "rating_food"         SMALLINT,
  "rating_wifi"         SMALLINT,
  "rating_management"   SMALLINT,
  "rating_maintenance"  SMALLINT,
  "rating_safety"       SMALLINT,
  "rating_value"        SMALLINT,

  "overall_rating"      SMALLINT,
  "would_recommend"     BOOLEAN,
  "improvement_text"    TEXT,
  "experience_text"     TEXT,

  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "exit_feedbacks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exit_feedbacks_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."move_out_requests"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "udx_ef_request" ON "public"."exit_feedbacks"("request_id");
CREATE INDEX IF NOT EXISTS "idx_ef_hostel" ON "public"."exit_feedbacks"("hostel_id");
CREATE INDEX IF NOT EXISTS "idx_ef_tenant" ON "public"."exit_feedbacks"("tenant_id");
