-- AlterEnum
BEGIN;
CREATE TYPE "public"."Role_new" AS ENUM ('ADMIN', 'OWNER', 'WARDEN', 'TENANT');
ALTER TABLE "public"."profiles" ALTER COLUMN "role" TYPE "public"."Role_new" USING ("role"::text::"public"."Role_new");
ALTER TYPE "public"."Role" RENAME TO "Role_old";
ALTER TYPE "public"."Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- AlterTable
ALTER TABLE "public"."rent_obligations" ADD COLUMN     "late_fee" DECIMAL(10,2) DEFAULT 0,
ADD COLUMN     "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE "public"."rent_obligations" SET "total_amount" = "amount";

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "public"."payments"("idempotency_key");

-- RenameForeignKey
ALTER TABLE "public"."complaints" RENAME CONSTRAINT "complaints_student_id_fkey" TO "complaints_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."payment_attempts" RENAME CONSTRAINT "payment_attempts_student_id_fkey" TO "payment_attempts_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."payments" RENAME CONSTRAINT "payments_student_id_fkey" TO "payments_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."reactivation_requests" RENAME CONSTRAINT "reactivation_requests_student_id_fkey" TO "reactivation_requests_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."receipts" RENAME CONSTRAINT "receipts_student_id_fkey" TO "receipts_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."reminder_logs" RENAME CONSTRAINT "reminder_logs_student_id_fkey" TO "reminder_logs_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."rent_obligations" RENAME CONSTRAINT "rent_obligations_student_id_fkey" TO "rent_obligations_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."room_allocations" RENAME CONSTRAINT "room_allocations_student_id_fkey" TO "room_allocations_tenant_id_fkey";

-- RenameForeignKey
ALTER TABLE "public"."tenants" RENAME CONSTRAINT "students_profile_id_fkey" TO "tenants_profile_id_fkey";

-- RenameIndex
ALTER INDEX "public"."payments_student_id_amount_paid_idx" RENAME TO "payments_tenant_id_amount_paid_idx";

-- RenameIndex
ALTER INDEX "public"."payments_student_id_idx" RENAME TO "payments_tenant_id_idx";

-- RenameIndex
ALTER INDEX "public"."payments_student_id_payment_date_idx" RENAME TO "payments_tenant_id_payment_date_idx";

-- RenameIndex
ALTER INDEX "public"."receipts_payment_id_unique" RENAME TO "receipts_payment_id_key";

-- RenameIndex
ALTER INDEX "public"."reminder_logs_student_id_idx" RENAME TO "reminder_logs_tenant_id_idx";

-- RenameIndex
ALTER INDEX "public"."rent_obligations_student_id_rent_month_idx" RENAME TO "rent_obligations_tenant_id_rent_month_idx";

-- RenameIndex
ALTER INDEX "public"."room_allocations_student_id_is_active_end_date_idx" RENAME TO "room_allocations_tenant_id_is_active_end_date_idx";

-- RenameIndex
ALTER INDEX "public"."students_aadhaar_number_key" RENAME TO "tenants_aadhaar_number_key";

-- RenameIndex
ALTER INDEX "public"."students_owner_id_idx" RENAME TO "tenants_owner_id_idx";

-- RenameIndex
ALTER INDEX "public"."students_profile_id_key" RENAME TO "tenants_profile_id_key";

