-- Backend-controlled tenant activation workflow.
-- Additive, compatibility-preserving changes only.

ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "guardian_name" TEXT,
  ADD COLUMN IF NOT EXISTS "guardian_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "guardian_relation" TEXT,
  ADD COLUMN IF NOT EXISTS "activation_started_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "activation_completed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "onboarding_last_activity_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "tenants_activation_completed_at_idx"
  ON "public"."tenants" ("activation_completed_at");

CREATE INDEX IF NOT EXISTS "tenants_onboarding_last_activity_at_idx"
  ON "public"."tenants" ("onboarding_last_activity_at");

ALTER TABLE "public"."RuleVersion"
  ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT 'Standard Hostel Rules',
  ADD COLUMN IF NOT EXISTS "content" JSONB,
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE "public"."RuleVersion"
SET "content" = COALESCE("content", "content_snapshot")
WHERE "content" IS NULL;

CREATE INDEX IF NOT EXISTS "RuleVersion_hostel_id_is_active_idx"
  ON "public"."RuleVersion" ("hostel_id", "is_active");

ALTER TABLE "public"."TenantPolicyAcceptance"
  ADD COLUMN IF NOT EXISTS "rules_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "public"."TenantPolicyAcceptance"
  ALTER COLUMN "typed_signature_name" DROP NOT NULL;
