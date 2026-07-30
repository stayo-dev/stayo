ALTER TABLE "public"."plans"
ADD COLUMN IF NOT EXISTS "can_generate_receipts" BOOLEAN NOT NULL DEFAULT false;

-- Single-owner architecture: receipts are not gated by SaaS subscription plans.
-- Keep this migration compatibility-only for databases that still have plans.
