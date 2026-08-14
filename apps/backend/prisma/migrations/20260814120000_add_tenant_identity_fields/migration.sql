-- Adds optional identity fields to tenants, needed for the StayO tenant
-- Profile tab's "Personal information" screen (Stayo Tenant.dc.html shows
-- blood group / nationality / Aadhaar / PAN, none of which had a home).
-- All nullable — no backfill needed, tenants fill these in themselves.
ALTER TABLE "public"."tenants"
  ADD COLUMN "blood_group" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "aadhaar_number" TEXT,
  ADD COLUMN "pan_number" TEXT;
