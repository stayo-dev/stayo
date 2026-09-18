-- 087_lead_acquisition_sources.sql — ADR-223
--
-- Admin could not tell who sourced a lead. Every lead reaching the Leads
-- screen read as "an owner filled in the form", because the demand-evidence
-- leads raised from Discover enquiries (src/services/marketing/
-- platform-listing-leads.ts) never set acquisition_source and so inherited the
-- WEBSITE default. A lead nobody submitted was indistinguishable from a lead
-- an owner submitted, which is the difference between a cold call and a
-- callback.
--
-- Two new values name the two ways a lead arrives without the owner asking:
--   DISCOVER_DEMAND  — tenants enquired about an unclaimed platform listing
--   STUDENT_REFERRAL — a student named the hostel on the public homepage
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op when the value is present.
-- Run these standalone (they are not wrapped in a DO block on purpose — a new
-- enum value may not be used in the transaction that adds it).

ALTER TYPE "PlatformLeadAcquisitionSource" ADD VALUE IF NOT EXISTS 'DISCOVER_DEMAND';
ALTER TYPE "PlatformLeadAcquisitionSource" ADD VALUE IF NOT EXISTS 'STUDENT_REFERRAL';
