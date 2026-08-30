-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 078: One active application per phone number
--
-- A phone number that already has a platform_leads row in any non-terminal-
-- rejected status ("already applied, being worked") must not be able to
-- create a second row via the public self-serve lead-capture form — whether
-- from a slow double-tap, a resubmitted form, or two concurrent requests
-- racing. LOST is the one status that does NOT block a resubmission: a
-- rejected applicant is allowed to reapply, and that reapplication is a
-- fresh row, not a resurrection of the old one.
--
-- Empty-phone rows are excluded from this constraint entirely: Discover's
-- "demand evidence" sales leads (buildPlatformLeadFromEnquiry, raised per
-- listed hostel with a deliberately blank phone) are a different invariant
-- keyed by hostel_name, not phone, and would collide with each other under
-- a bare phone-only index the moment two different hostels both raised
-- their first such lead.
--
-- Enforced at the database, not just in application code, per explicit
-- product ask — a partial unique index is the only way to guarantee this
-- under concurrent requests. Apply via the Supabase SQL editor or psql, per
-- migrations/README.md.
--
-- Pre-flight check before applying in production (fails loudly, on purpose,
-- if violated — resolve any hits manually first):
--   SELECT phone, count(*) FROM platform_leads
--   WHERE status <> 'LOST' AND phone <> '' GROUP BY phone HAVING count(*) > 1;
-- ══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS platform_leads_one_active_lead_per_phone
  ON platform_leads (phone)
  WHERE status <> 'LOST' AND phone <> '';
