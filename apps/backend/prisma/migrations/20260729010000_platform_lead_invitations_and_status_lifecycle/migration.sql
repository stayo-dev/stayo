-- Owner acquisition funnel, phase 2: real lead approval -> activation ->
-- auto-progressing lifecycle. Guarded to be re-runnable.

-- 1. Replace PlatformLeadStatus with the real business-progress lifecycle.
--    Guarded on whether the new value 'UNDER_REVIEW' already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PlatformLeadStatus' AND e.enumlabel = 'UNDER_REVIEW'
  ) THEN
    CREATE TYPE "PlatformLeadStatus_new" AS ENUM (
      'NEW', 'UNDER_REVIEW', 'APPROVED', 'INVITE_SENT',
      'OWNER_ACTIVATED', 'HOSTEL_CREATED', 'LIVE', 'LOST'
    );

    ALTER TABLE "platform_leads" ALTER COLUMN "status" DROP DEFAULT;

    ALTER TABLE "platform_leads"
      ALTER COLUMN "status" TYPE "PlatformLeadStatus_new"
      USING (
        CASE status::text
          WHEN 'CONTACTED' THEN 'APPROVED'
          WHEN 'DEMO_SCHEDULED' THEN 'UNDER_REVIEW'
          WHEN 'ONBOARDING' THEN 'INVITE_SENT'
          WHEN 'ACTIVE' THEN 'LIVE'
          WHEN 'NEW' THEN 'NEW'
          WHEN 'LOST' THEN 'LOST'
          ELSE 'NEW'
        END
      )::"PlatformLeadStatus_new"
    ;

    ALTER TABLE "platform_leads" ALTER COLUMN "status" SET DEFAULT 'NEW'::"PlatformLeadStatus_new";

    DROP TYPE "PlatformLeadStatus";
    ALTER TYPE "PlatformLeadStatus_new" RENAME TO "PlatformLeadStatus";
  END IF;
END $$;

-- 2. New single-use activation-token table for approved leads.
CREATE TABLE IF NOT EXISTS "platform_lead_invitations" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "lead_id"    UUID NOT NULL,
  "token"      TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_lead_invitations_token_key" ON "platform_lead_invitations"("token");
CREATE INDEX IF NOT EXISTS "platform_lead_invitations_lead_id_idx" ON "platform_lead_invitations"("lead_id");
