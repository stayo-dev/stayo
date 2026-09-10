-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 079: One active visitor lead per (hostel, phone)
--
-- An owner (or a public QR/admissions-link submission) resubmitting the same
-- phone number for the same hostel must not create a second `visitor_leads`
-- row — whether from a slow double-tap, a resubmitted form, or two
-- concurrent requests racing. The application already tries to dedupe by
-- updating the existing row instead of inserting (see `createLead` /
-- `createDirectLead` in admissions-service.ts); this makes that guarantee
-- hold under concurrency too, the same way migration 078 did for
-- `platform_leads`.
--
-- Only "active" statuses block a resubmission — the same set the app already
-- treats as "still an open enquiry" (`ACTIVE_LEAD_STATUSES`): NEW,
-- INTERESTED, ROOM_VISITED, DECISION_PENDING, READY_TO_JOIN, ACCEPTED,
-- ON_HOLD, INVITED. LOST, REJECTED and JOINED are deliberately excluded —
-- a rejected/lost enquiry may reapply, and a JOINED lead means the person is
-- already a tenant (blocked separately, at creation time, by a direct
-- `tenants` lookup — see `hasLiveTenancyAtHostel`), not by resurrecting the
-- old lead row.
--
-- Empty-phone rows are excluded from this constraint entirely: a lead with
-- no phone captured yet must not collide with any other such row for the
-- same hostel.
--
-- Enforced at the database, not just in application code — a partial unique
-- index is the only way to guarantee this under concurrent requests. Apply
-- via the Supabase SQL editor or psql, per migrations/README.md.
--
-- Pre-flight check before applying in production (fails loudly, on purpose,
-- if violated — resolve any hits manually first):
--   SELECT hostel_id, student_phone, count(*) FROM visitor_leads
--   WHERE student_phone IS NOT NULL
--     AND status IN ('NEW','INTERESTED','ROOM_VISITED','DECISION_PENDING','READY_TO_JOIN','ACCEPTED','ON_HOLD','INVITED')
--   GROUP BY hostel_id, student_phone HAVING count(*) > 1;
-- ══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS visitor_leads_one_active_lead_per_hostel_phone
  ON visitor_leads (hostel_id, student_phone)
  WHERE student_phone IS NOT NULL
    AND status IN ('NEW','INTERESTED','ROOM_VISITED','DECISION_PENDING','READY_TO_JOIN','ACCEPTED','ON_HOLD','INVITED');
