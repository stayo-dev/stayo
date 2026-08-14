-- Adds an optional "expected exit" date to tenants, needed for the StayO
-- tenant Profile tab's "Academic details" screen (Duration section: Joined /
-- Expected exit). Nullable — no backfill, tenants fill it in themselves.
ALTER TABLE "public"."tenants"
  ADD COLUMN "expected_completion_date" DATE;
