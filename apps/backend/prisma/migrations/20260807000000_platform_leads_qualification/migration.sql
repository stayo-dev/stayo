-- Qualification answers captured by the conversational lead-capture flow.
-- Purely additive and nullable: every existing row predates the questions, so
-- there is nothing to backfill and no constraint to apply.

ALTER TABLE "platform_leads" ADD COLUMN "pain_point" TEXT;
ALTER TABLE "platform_leads" ADD COLUMN "current_tooling" TEXT;
