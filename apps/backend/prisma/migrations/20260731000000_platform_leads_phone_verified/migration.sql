-- Signup phone-verification fallback: records whether a lead's phone was
-- really OTP-verified, or accepted unverified because WhatsApp could not
-- deliver. Idempotent — safe to re-run.

ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "phone_verified" BOOLEAN NOT NULL DEFAULT FALSE;
