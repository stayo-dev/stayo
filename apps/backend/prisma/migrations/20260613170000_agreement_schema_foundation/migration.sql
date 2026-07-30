-- Agreement Schema Foundation
-- Additive agreement lifecycle fields only. No rent, occupancy, or payment data is changed.

ALTER TYPE "public"."AgreementStatus" ADD VALUE IF NOT EXISTS 'EXPIRING_SOON';
ALTER TYPE "public"."AgreementStatus" ADD VALUE IF NOT EXISTS 'AGREEMENT_EXPIRED';
ALTER TYPE "public"."AgreementStatus" ADD VALUE IF NOT EXISTS 'RENEWED';
ALTER TYPE "public"."AgreementStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

ALTER TABLE "public"."Agreement"
  ADD COLUMN IF NOT EXISTS "renewed_from_agreement_id" UUID,
  ADD COLUMN IF NOT EXISTS "renewed_to_agreement_id" UUID,
  ADD COLUMN IF NOT EXISTS "agreement_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "agreement_start_date" DATE,
  ADD COLUMN IF NOT EXISTS "agreement_end_date" DATE,
  ADD COLUMN IF NOT EXISTS "agreement_duration_months" INTEGER,
  ADD COLUMN IF NOT EXISTS "contract_rent" NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS "contract_security_deposit" NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS "contract_maintenance" NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS "contract_maintenance_type" TEXT,
  ADD COLUMN IF NOT EXISTS "contract_payment_frequency" "public"."PaymentFrequency",
  ADD COLUMN IF NOT EXISTS "expiry_notified_30d_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "expiry_notified_15d_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "expired_notified_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "terminated_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "renewed_at" TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Agreement_renewed_from_agreement_id_fkey'
      AND conrelid = 'public."Agreement"'::regclass
  ) THEN
    ALTER TABLE "public"."Agreement"
      ADD CONSTRAINT "Agreement_renewed_from_agreement_id_fkey"
      FOREIGN KEY ("renewed_from_agreement_id") REFERENCES "public"."Agreement"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Agreement_renewed_to_agreement_id_fkey'
      AND conrelid = 'public."Agreement"'::regclass
  ) THEN
    ALTER TABLE "public"."Agreement"
      ADD CONSTRAINT "Agreement_renewed_to_agreement_id_fkey"
      FOREIGN KEY ("renewed_to_agreement_id") REFERENCES "public"."Agreement"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Agreement_tenant_id_status_idx"
  ON "public"."Agreement" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "Agreement_hostel_id_status_agreement_end_date_idx"
  ON "public"."Agreement" ("hostel_id", "status", "agreement_end_date");

CREATE INDEX IF NOT EXISTS "Agreement_status_agreement_end_date_idx"
  ON "public"."Agreement" ("status", "agreement_end_date");

CREATE INDEX IF NOT EXISTS "Agreement_renewed_from_agreement_id_idx"
  ON "public"."Agreement" ("renewed_from_agreement_id");

CREATE INDEX IF NOT EXISTS "Agreement_renewed_to_agreement_id_idx"
  ON "public"."Agreement" ("renewed_to_agreement_id");
