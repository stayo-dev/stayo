-- Migration: Bulk Tenant Onboarding System
-- Date: 2026-05-13
-- Purpose: Add fields for password reset enforcement and bulk import tracking

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1: Password Reset Enforcement
-- ══════════════════════════════════════════════════════════════════════════════
-- Add password reset requirement flag to Profile table
-- This flags accounts that must reset password on first login (imported tenants)
ALTER TABLE "public"."profiles" 
  ADD COLUMN IF NOT EXISTS "password_reset_required" BOOLEAN DEFAULT false;

-- Add timestamp for when password was last reset
ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "password_reset_at" TIMESTAMPTZ(6);

-- Add onboarding password flag to identify accounts created via bulk import
ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "is_imported" BOOLEAN DEFAULT false;

-- Add import batch tracking
ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "import_batch_id" UUID;

-- Add onboarding password expiration (30 days from import)
ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "onboarding_expires_at" TIMESTAMPTZ(6);

-- Index for efficiently finding accounts requiring password reset
CREATE INDEX IF NOT EXISTS "idx_profiles_password_reset_required" 
  ON "public"."profiles" ("password_reset_required", "is_active")
  WHERE "password_reset_required" = true;

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2: Rate Limiting for Login Attempts
-- ══════════════════════════════════════════════════════════════════════════════
-- Create table for tracking login attempts (phone + IP based rate limiting)
CREATE TABLE IF NOT EXISTS "public"."login_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" VARCHAR(255) NOT NULL, -- phone number or email
  "ip_address" VARCHAR(45),           -- IPv4 or IPv6
  "attempt_type" VARCHAR(50) NOT NULL, -- 'ONBOARDING' | 'REGULAR'
  "success" BOOLEAN DEFAULT false,
  "failure_reason" VARCHAR(255),
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT now()
);

-- Indexes for rate limiting queries
CREATE INDEX IF NOT EXISTS "idx_login_attempts_identifier_created" 
  ON "public"."login_attempts" ("identifier", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_login_attempts_ip_created" 
  ON "public"."login_attempts" ("ip_address", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_login_attempts_type_created" 
  ON "public"."login_attempts" ("attempt_type", "created_at" DESC);

-- Composite index for efficient rate limit checks
CREATE INDEX IF NOT EXISTS "idx_login_attempts_identifier_ip_created" 
  ON "public"."login_attempts" ("identifier", "ip_address", "created_at" DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 3: Bulk Import Audit Trail
-- ══════════════════════════════════════════════════════════════════════════════
-- Create table for tracking bulk import operations
CREATE TABLE IF NOT EXISTS "public"."bulk_import_batches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL REFERENCES "public"."profiles"("id"),
  "hostel_id" UUID NOT NULL REFERENCES "public"."hostels"("id"),
  "filename" VARCHAR(255) NOT NULL,
  "file_size" INTEGER,
  "total_rows" INTEGER DEFAULT 0,
  "valid_rows" INTEGER DEFAULT 0,
  "failed_rows" INTEGER DEFAULT 0,
  "imported_rows" INTEGER DEFAULT 0,
  "duplicate_rows" INTEGER DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'PENDING', -- PENDING | VALIDATED | IMPORTING | COMPLETED | FAILED
  "validation_errors" JSONB,
  "import_summary" JSONB,
  "import_source_version" VARCHAR(50) DEFAULT 'google_form_v1', -- Tracks format evolution
  "uploaded_by" UUID NOT NULL REFERENCES "public"."profiles"("id"),
  "uploaded_at" TIMESTAMPTZ(6) DEFAULT now(),
  "validated_at" TIMESTAMPTZ(6),
  "imported_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6)
);

-- Indexes for bulk import tracking
CREATE INDEX IF NOT EXISTS "idx_bulk_import_owner_created" 
  ON "public"."bulk_import_batches" ("owner_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_bulk_import_hostel_created" 
  ON "public"."bulk_import_batches" ("hostel_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_bulk_import_status" 
  ON "public"."bulk_import_batches" ("status", "created_at" DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- PART 4: Add Comments for Documentation
-- ══════════════════════════════════════════════════════════════════════════════
COMMENT ON COLUMN "public"."profiles"."password_reset_required" IS 
  'Flags accounts requiring mandatory password reset on first login (bulk imported tenants)';

COMMENT ON COLUMN "public"."profiles"."is_imported" IS 
  'Identifies accounts created via bulk import (not invitation-based onboarding)';

COMMENT ON COLUMN "public"."profiles"."import_batch_id" IS 
  'Reference to bulk_import_batches for audit trail';

COMMENT ON TABLE "public"."login_attempts" IS 
  'Rate limiting and security audit log for login attempts (both regular and onboarding)';

COMMENT ON TABLE "public"."bulk_import_batches" IS 
  'Audit trail for bulk tenant import operations with validation and import statistics';
