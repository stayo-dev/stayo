-- Billing & Occupancy Engine Fixes
-- Additive contract for agreement-bound rent schedules and FIFO settlement.

ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'UPCOMING';
ALTER TYPE "public"."PaymentStatus" ADD VALUE IF NOT EXISTS 'OVERDUE';

ALTER TABLE "public"."rent_obligations"
  ADD COLUMN IF NOT EXISTS "agreement_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rent_obligations_agreement_id_fkey'
      AND conrelid = 'public.rent_obligations'::regclass
  ) THEN
    ALTER TABLE "public"."rent_obligations"
      ADD CONSTRAINT "rent_obligations_agreement_id_fkey"
      FOREIGN KEY ("agreement_id") REFERENCES "public"."Agreement"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "rent_obligations_agreement_id_rent_month_obligation_type_key"
  ON "public"."rent_obligations" ("agreement_id", "rent_month", "obligation_type");

CREATE INDEX IF NOT EXISTS "rent_obligations_agreement_id_idx"
  ON "public"."rent_obligations" ("agreement_id");

CREATE INDEX IF NOT EXISTS "rent_obligations_tenant_id_status_due_date_idx"
  ON "public"."rent_obligations" ("tenant_id", "status", "due_date");
