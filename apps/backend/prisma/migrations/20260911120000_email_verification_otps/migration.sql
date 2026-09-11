-- Email verification codes for tenant onboarding.
--
-- A tenant invited by phone alone used to get `<phone>@hms.temp` as their
-- account email — a stand-in for NOT NULL `profiles.email`, which then became
-- their login and was shown to their owner as though it were an address.
-- Onboarding now requires the tenant to give a real email and prove it with a
-- code. This is that code's record, a sibling of `phone_verification_otps`.
--
-- A NEW table only — no existing table or column changes, so no read of any
-- other model is affected by the deploy/migrate order. The code that uses it
-- is the onboarding email step; APPLY THIS BEFORE DEPLOYING that code, or a
-- phone-only tenant cannot finish onboarding until it is applied.

CREATE TABLE IF NOT EXISTS "email_verification_otps" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  -- The onboarding it belongs to. A code proves an address *for this
  -- invitation*; it is never accepted for another one.
  "invitation_id" UUID,
  "email"         TEXT        NOT NULL,
  "otp_hash"      TEXT        NOT NULL,
  "purpose"       TEXT        NOT NULL,
  -- PENDING → VERIFIED → CONSUMED (written onto the account), or EXPIRED /
  -- LOCKED. CONSUMED is what stops one verification being reused.
  "status"        TEXT        NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER     NOT NULL DEFAULT 0,
  "max_attempts"  INTEGER     NOT NULL DEFAULT 5,
  "expires_at"    TIMESTAMPTZ(6) NOT NULL,
  "verified_at"   TIMESTAMPTZ(6),
  "consumed_at"   TIMESTAMPTZ(6),
  "failure_reason" TEXT,
  "request_ip"    TEXT,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "email_verification_otps_pkey" PRIMARY KEY ("id")
);

-- The ACCOUNT step's question: "is there a verified, unconsumed code for this
-- invitation and this address?"
CREATE INDEX IF NOT EXISTS "email_verification_otps_invitation_email_status_idx"
  ON "email_verification_otps" ("invitation_id", "email", "status");
-- Send-rate limiting when Redis is unavailable.
CREATE INDEX IF NOT EXISTS "email_verification_otps_email_created_idx"
  ON "email_verification_otps" ("email", "created_at");
CREATE INDEX IF NOT EXISTS "email_verification_otps_ip_created_idx"
  ON "email_verification_otps" ("request_ip", "created_at");
CREATE INDEX IF NOT EXISTS "email_verification_otps_expires_idx"
  ON "email_verification_otps" ("expires_at");
