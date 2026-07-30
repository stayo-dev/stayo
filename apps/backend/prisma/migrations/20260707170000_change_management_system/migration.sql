-- ════════════════════════════════════════════════════════════
-- Change Management System — Database Migration
-- Centralized lifecycle for all governed data modifications.
-- ════════════════════════════════════════════════════════════

-- Enums
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'APPLIED', 'CANCELLED');
CREATE TYPE "ChangeCategory" AS ENUM ('A', 'B', 'C', 'D');
CREATE TYPE "ChangeApprovalLevel" AS ENUM ('L0', 'L1', 'L2', 'L3');

-- change_requests — Central table for all governed mutations
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "hostel_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "change_category" "ChangeCategory" NOT NULL,
    "change_type" TEXT NOT NULL,
    "approval_level" "ChangeApprovalLevel" NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "applied_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "current_snapshot" JSONB NOT NULL,
    "proposed_changes" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "effective_date" DATE,
    "financial_impact" JSONB,
    "expires_at" TIMESTAMPTZ(6),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "last_reminded_at" TIMESTAMPTZ(6),
    "creates_version" INTEGER,
    "supersedes_version" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- change_request_events — Immutable audit timeline
CREATE TABLE "change_request_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "change_request_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT NOT NULL,
    "snapshot" JSONB,
    "notes" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_request_events_pkey" PRIMARY KEY ("id")
);

-- Agreement amendment traceability columns
ALTER TABLE "Agreement" ADD COLUMN IF NOT EXISTS "amendment_reason" TEXT;
ALTER TABLE "Agreement" ADD COLUMN IF NOT EXISTS "change_request_id" UUID;

-- Indexes for change_requests
CREATE INDEX "idx_cr_tenant_status" ON "change_requests"("tenant_id", "status");
CREATE INDEX "idx_cr_owner_status" ON "change_requests"("owner_id", "status");
CREATE INDEX "idx_cr_entity" ON "change_requests"("entity_type", "entity_id");
CREATE INDEX "idx_cr_pending_expiry" ON "change_requests"("expires_at");
CREATE INDEX "idx_cr_hostel_status" ON "change_requests"("hostel_id", "status");

-- Indexes for change_request_events
CREATE INDEX "idx_cre_request" ON "change_request_events"("change_request_id");

-- Foreign keys
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_hostel_id_fkey" FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_request_events" ADD CONSTRAINT "change_request_events_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
