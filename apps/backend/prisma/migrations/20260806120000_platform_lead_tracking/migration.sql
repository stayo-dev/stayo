-- Three-step add: the table has existing rows, so a straight
-- "ADD COLUMN NOT NULL UNIQUE" would fail. Add nullable, backfill, constrain.

ALTER TABLE "platform_leads" ADD COLUMN "tracking_token" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN "applicant_message" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN "rejection_reason" TEXT;

UPDATE "platform_leads"
SET "tracking_token" = encode(gen_random_bytes(32), 'hex')
WHERE "tracking_token" IS NULL;

ALTER TABLE "platform_leads" ALTER COLUMN "tracking_token" SET NOT NULL;
CREATE UNIQUE INDEX "platform_leads_tracking_token_key"
  ON "platform_leads"("tracking_token");
