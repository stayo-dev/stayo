-- ============================================================
-- Migration: Document Storage Upgrade
-- Adds: document_status enum, file_id, rejection_reason
-- Replaces: is_verified boolean with document_status enum
-- ============================================================

-- 1. Create the DocumentStatus enum
DO $$ BEGIN
  CREATE TYPE "public"."DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add new columns to identification_documents
ALTER TABLE "public"."identification_documents"
  ADD COLUMN IF NOT EXISTS "file_id" TEXT,
  ADD COLUMN IF NOT EXISTS "document_status" "public"."DocumentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

-- 3. Migrate existing data: is_verified=true → APPROVED, else PENDING
UPDATE "public"."identification_documents"
SET "document_status" = CASE
  WHEN "is_verified" = true THEN 'APPROVED'::"public"."DocumentStatus"
  ELSE 'PENDING'::"public"."DocumentStatus"
END;

-- 4. Add unique constraint on aadhaar_number for duplicate prevention
-- (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "students_aadhaar_number_unique"
  ON "public"."students" ("aadhaar_number")
  WHERE "aadhaar_number" IS NOT NULL;

-- 5. Add index on document_status for filtering
CREATE INDEX IF NOT EXISTS "idx_identification_documents_status"
  ON "public"."identification_documents" ("document_status");

-- NOTE: We keep is_verified for backward compatibility during transition.
-- After frontend is updated, run: ALTER TABLE identification_documents DROP COLUMN is_verified;
