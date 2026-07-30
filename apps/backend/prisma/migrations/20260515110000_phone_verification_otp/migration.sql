ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "phone_verified" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "public"."phone_verification_otps" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone" TEXT NOT NULL,
  "otp_hash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "verified_at" TIMESTAMPTZ(6),
  "meta_message_id" TEXT,
  "provider_status" TEXT,
  "failure_reason" TEXT,
  "request_ip" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "phone_verification_otps_phone_idx"
  ON "public"."phone_verification_otps" ("phone");

CREATE INDEX IF NOT EXISTS "phone_verification_otps_expires_at_idx"
  ON "public"."phone_verification_otps" ("expires_at");

CREATE INDEX IF NOT EXISTS "phone_verification_otps_status_idx"
  ON "public"."phone_verification_otps" ("status");

CREATE INDEX IF NOT EXISTS "phone_verification_otps_meta_message_id_idx"
  ON "public"."phone_verification_otps" ("meta_message_id");

CREATE INDEX IF NOT EXISTS "phone_verification_otps_request_ip_created_at_idx"
  ON "public"."phone_verification_otps" ("request_ip", "created_at");
