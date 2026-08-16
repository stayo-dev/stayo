-- 067_lead_crm.sql
--
-- Merges the sales funnel into the existing activation funnel, and gives the
-- admin console somewhere to record what actually happened on each call.
--
-- Background: the Claude design ships a SALES pipeline (New → Contacted →
-- Demo → Negotiating → Converted) while the codebase implements an ACTIVATION
-- funnel (NEW → APPROVED → INVITE_SENT → OWNER_ACTIVATED → HOSTEL_CREATED →
-- LIVE). They are the front and back halves of one journey, not competing
-- models, so this migration extends the one enum rather than adding a second
-- status column.
--
-- Ownership stays split, and that split is enforced in application code:
--   admin-driven  : NEW, CONTACTED, DEMO, NEGOTIATING, LOST
--   system-driven : APPROVED, INVITE_SENT, OWNER_ACTIVATED, HOSTEL_CREATED, LIVE
-- See app/api/platform-admin/leads/[id]/route.ts (MANUALLY_SETTABLE_STATUSES).
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.
-- Order matters: the enum values must exist and be committed before any row
-- can be moved onto them, hence the two explicit statements below rather than
-- one combined block.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New sales stages on the existing enum.
--    ADD VALUE cannot run inside a transaction block that later uses the value,
--    so these are standalone and idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE "PlatformLeadStatus" ADD VALUE IF NOT EXISTS 'CONTACTED';
ALTER TYPE "PlatformLeadStatus" ADD VALUE IF NOT EXISTS 'DEMO';
ALTER TYPE "PlatformLeadStatus" ADD VALUE IF NOT EXISTS 'NEGOTIATING';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Structured lost reasons.
--
--    platform_leads.pain_point and current_tooling are deliberately free-form
--    (their schema comment warns they are not safe to aggregate — a reworded
--    marketing option produces a new distinct value). That is exactly why the
--    lost reason is a real enum: the "why leads are lost" chart aggregates
--    this and nothing else.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlatformLeadLostReason') THEN
    CREATE TYPE "PlatformLeadLostReason" AS ENUM (
      'PRICE',
      'WENT_WITH_COMPETITOR',
      'NOT_READY',
      'NO_RESPONSE',
      'MISSING_FEATURE',
      'TOO_SMALL',
      'OTHER'
    );
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Qualification + discovery captured on the call.
--
--    These are the answers an admin fills in while talking to the owner, and
--    are the whole point of the drawer: the next call should start from what
--    the last one learned.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE platform_leads
  ADD COLUMN IF NOT EXISTS lost_reason          "PlatformLeadLostReason",
  ADD COLUMN IF NOT EXISTS lost_note            TEXT,
  ADD COLUMN IF NOT EXISTS discovery_problem    TEXT,
  ADD COLUMN IF NOT EXISTS discovery_why        TEXT,
  ADD COLUMN IF NOT EXISTS discovery_expect     TEXT,
  ADD COLUMN IF NOT EXISTS qual_beds            INTEGER,
  ADD COLUMN IF NOT EXISTS qual_rooms           INTEGER,
  ADD COLUMN IF NOT EXISTS qual_occupancy_pct   INTEGER,
  ADD COLUMN IF NOT EXISTS qual_monthly_revenue NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS qual_branches        TEXT,
  ADD COLUMN IF NOT EXISTS estimated_value      NUMERIC(12, 2);

COMMENT ON COLUMN platform_leads.lost_reason IS
  'Structured so "why leads are lost" can be aggregated. Free-text detail goes in lost_note.';
COMMENT ON COLUMN platform_leads.estimated_value IS
  'Admin''s estimate of annual contract value, captured during qualification. Not a billed amount.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The outreach log — one row per call/email/WhatsApp attempt.
--
--    Deliberately NOT systemEventLog: that table is the automated audit trail
--    (and carries lead_id inside metadata, with no column — see Decisions.md).
--    This is human-authored, edited during a call, and needs to be queried per
--    lead cheaply. The drawer merges both feeds for display.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_lead_activities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES platform_leads (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,          -- CALL | EMAIL | WHATSAPP | MEETING
  outcome    TEXT NOT NULL,          -- CONNECTED | NO_ANSWER | SENT | ...
  note       TEXT,
  actor_id   UUID REFERENCES profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead
  ON platform_lead_activities (lead_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The notes thread.
--
--    platform_leads.notes already exists as a single free-text scratchpad.
--    It is kept (nothing reads it destructively), but a thread is what the
--    design shows and what actually survives a handover between two admins.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_lead_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES platform_leads (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  author_id  UUID REFERENCES profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead
  ON platform_lead_notes (lead_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Migrate UNDER_REVIEW → CONTACTED.
--
--    UNDER_REVIEW predates the sales funnel and means "an admin has picked
--    this up", which is exactly CONTACTED in the merged model. Run as a
--    separate statement AFTER the ADD VALUE statements above have committed.
--
--    UNDER_REVIEW is intentionally NOT dropped from the enum: Postgres cannot
--    remove an enum value without recreating the type, and leaving it costs
--    nothing once no rows and no code reference it.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE platform_leads
SET status = 'CONTACTED', updated_at = now()
WHERE status = 'UNDER_REVIEW';
