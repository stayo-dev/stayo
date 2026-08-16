-- 069_platform_support_tickets.sql
--
-- BACKFILL of a missing migration, not a new feature.
--
-- The Profile → "Raise a Ticket" work (ADR-079) shipped its Prisma model but
-- no SQL migration, so `platform_support_tickets` never existed in any
-- database. Every call to GET /api/platform-admin/support-tickets has been
-- returning 500 since it merged; it only became visible when the rebuilt admin
-- console started polling that endpoint for the Reports & Bugs badge on every
-- page load.
--
-- Transcribed directly from the model in prisma/schema.prisma so the two
-- cannot disagree.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.

CREATE TABLE IF NOT EXISTS platform_support_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  UUID NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  -- APP_BUG | ACCOUNT_ISSUE | PAYMENT_ISSUE | OTHER. A plain string, matching
  -- this schema's convention for descriptive statuses; the allowed set is
  -- enforced at the API boundary.
  category    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  description TEXT NOT NULL,
  -- OPEN until a Stayo admin resolves it — never set by the reporter.
  status      TEXT NOT NULL DEFAULT 'OPEN',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  -- Admin's resolution note, shown back to the reporter.
  admin_note  TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_support_tickets_profile
  ON platform_support_tickets (profile_id);

-- The admin queue reads by status; both tabs (OPEN / RESOLVED) hit this.
CREATE INDEX IF NOT EXISTS idx_platform_support_tickets_status
  ON platform_support_tickets (status);
