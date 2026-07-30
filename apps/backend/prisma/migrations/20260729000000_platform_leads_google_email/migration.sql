-- Real Google-auth lead capture on the landing page: store the Google
-- email captured during the self-serve lead flow. Idempotent — safe to re-run.

ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "google_email" TEXT;
