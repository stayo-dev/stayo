ALTER TABLE "public"."rent_obligations" ADD COLUMN "obligation_type" TEXT NOT NULL DEFAULT 'RENT';

ALTER TABLE "public"."rent_obligations" DROP CONSTRAINT IF EXISTS "rent_obligations_allocation_id_rent_month_key";

CREATE UNIQUE INDEX IF NOT EXISTS "rent_obligations_allocation_id_rent_month_obligation_type_key" ON "public"."rent_obligations"("allocation_id", "rent_month", "obligation_type");

CREATE TABLE "public"."reminder_logs" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "reminder_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reminder_logs_obligation_id_idx" ON "public"."reminder_logs"("obligation_id");
CREATE INDEX "reminder_logs_student_id_idx" ON "public"."reminder_logs"("student_id");

ALTER TABLE "public"."reminder_logs" ADD CONSTRAINT "reminder_logs_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "public"."rent_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."reminder_logs" ADD CONSTRAINT "reminder_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
