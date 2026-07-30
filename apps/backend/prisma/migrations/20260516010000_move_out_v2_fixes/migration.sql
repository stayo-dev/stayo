-- Move-Out v2 Fixes: State Machine, Disputes, Structured Inspection, Freeze Logic

-- 1. Fix MoveOutStatus enum: remove old values, add new ones
-- Note: Postgres doesn't support DROP VALUE, so we add new values only.
-- Old values (UNDER_REVIEW, AWAITING_SETTLEMENT, APPROVED) won't be used.
ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_PENDING';
ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_DONE';
ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'SETTLEMENT_APPROVED';
ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "public"."MoveOutStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';

-- 2. Remove SETTLEMENT_PENDING from TenantStatus (it's now in MoveOutStatus)
-- Postgres can't remove enum values, so this is a no-op. We just won't use it.

-- 3. Add new columns to move_out_requests
ALTER TABLE "public"."move_out_requests"
  ADD COLUMN IF NOT EXISTS "financial_completion_date" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "physical_exit_date" DATE,
  ADD COLUMN IF NOT EXISTS "room_release_date" DATE,
  ADD COLUMN IF NOT EXISTS "is_eviction" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "eviction_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "freeze_room_transfer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "freeze_rent_generation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "freeze_profile_edits" BOOLEAN NOT NULL DEFAULT false;

-- 4. Fix inspection: add total_deductions, drop inventory_checklist
ALTER TABLE "public"."move_out_inspections"
  ADD COLUMN IF NOT EXISTS "total_deductions" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "public"."move_out_inspections"
  DROP COLUMN IF EXISTS "inventory_checklist";

-- 5. Create structured inspection items table
CREATE TABLE IF NOT EXISTS "public"."move_out_inspection_items" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id"      UUID NOT NULL,
  "item_name"       VARCHAR(100) NOT NULL,
  "item_category"   VARCHAR(30) NOT NULL DEFAULT 'FURNITURE',
  "condition"       VARCHAR(20) NOT NULL DEFAULT 'OK',
  "charge_amount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "evidence_url"    TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "move_out_inspection_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "move_out_inspection_items_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "public"."move_out_requests"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_moii_request" ON "public"."move_out_inspection_items"("request_id");

-- 6. Add advance_balance to settlement transactions
ALTER TABLE "public"."exit_settlement_transactions"
  ADD COLUMN IF NOT EXISTS "advance_balance" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- 7. Create exit_disputes table
CREATE TABLE IF NOT EXISTS "public"."exit_disputes" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id"        UUID NOT NULL,
  "raised_by"         UUID NOT NULL,
  "raised_by_role"    VARCHAR(20) NOT NULL,
  "dispute_type"      VARCHAR(40) NOT NULL,
  "description"       TEXT NOT NULL,
  "disputed_amount"   DECIMAL(10,2),
  "evidence_urls"     TEXT[] DEFAULT '{}',
  "status"            VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "resolution_notes"  TEXT,
  "resolved_by"       UUID,
  "resolved_at"       TIMESTAMPTZ(6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6),

  CONSTRAINT "exit_disputes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exit_disputes_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "public"."move_out_requests"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_ed_request_status" ON "public"."exit_disputes"("request_id", "status");

-- 8. Add rating_noise to exit_feedbacks
ALTER TABLE "public"."exit_feedbacks"
  ADD COLUMN IF NOT EXISTS "rating_noise" SMALLINT;
