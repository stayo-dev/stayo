-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 066: Hostel marketing page, with admin approval
--
-- The listing a tenant sees in Discover is now owner-authored content —
-- photos, bed tiers and prices, amenities, nearby places, basics — and every
-- version of it is approved by a platform admin before it can be seen.
--
-- ── Why revisions, and not columns on `hostels` ────────────────────────────
--
-- Edit-in-place plus a "needs review" flag has a failure that shows up the
-- first day it ships: an owner fixing a typo drops their hostel out of
-- Discovery until an admin gets round to it, and a rejected edit takes down a
-- page that was previously fine.
--
-- A revision fixes both. The APPROVED revision keeps serving Discovery while
-- a DRAFT is edited and reviewed, so the live page never flickers, and the
-- admin approves a specific, diffable snapshot rather than "whatever the row
-- says right now". Same reasoning as `agreements.content_snapshot` and
-- `RuleVersion` elsewhere in this schema.
--
-- ── Why the content is one JSONB column ────────────────────────────────────
--
-- A revision is an immutable snapshot. Child tables (photos, beds, places)
-- would each need their own versioning to belong to one, which is a second
-- revision system to keep in step with this one. The shape is validated in
-- `marketing-content.ts` on the way in, so this is a checked payload, not a
-- bag of anything.
--
-- ── What this does NOT change ──────────────────────────────────────────────
--
-- `hostels.listing_status` / `verification_status` stay exactly as ADR-040
-- left them: admin-controlled, and the gate on whether a hostel is
-- discoverable *at all*. This adds a second, independent gate on its
-- *content*. A hostel needs both.
--
-- See docs/superpowers/specs/ — hostel marketing page.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hostel_marketing_revisions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id     uuid        NOT NULL REFERENCES hostels (id) ON DELETE CASCADE,

  -- Monotonic per hostel. Human-facing ("v3 approved"), and it makes the
  -- ordering explicit rather than inferred from timestamps.
  version       integer     NOT NULL,

  -- DRAFT | PENDING_REVIEW | APPROVED | REJECTED | SUPERSEDED
  --
  -- SUPERSEDED is what a previously-APPROVED revision becomes when a newer one
  -- is approved. Kept rather than deleted: it is the record of what was
  -- advertised at a given time, which matters the moment a tenant says "the
  -- listing said ₹4,500".
  status        text        NOT NULL DEFAULT 'DRAFT',

  content       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  submitted_at  timestamptz,
  submitted_by  uuid        REFERENCES profiles (id),
  reviewed_at   timestamptz,
  reviewed_by   uuid        REFERENCES profiles (id),
  -- Owner-visible on reject, so "no" always comes with a reason they can act
  -- on. Distinct from any internal admin note.
  review_note   text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS hostel_marketing_revisions_hostel_version_key
  ON hostel_marketing_revisions (hostel_id, version);

-- At most one editable draft per hostel. Without this, two admin/owner tabs
-- produce rival drafts and whichever submits last silently wins.
CREATE UNIQUE INDEX IF NOT EXISTS hostel_marketing_one_draft_per_hostel
  ON hostel_marketing_revisions (hostel_id)
  WHERE status IN ('DRAFT', 'PENDING_REVIEW');

-- At most one live revision per hostel — the one Discovery renders.
CREATE UNIQUE INDEX IF NOT EXISTS hostel_marketing_one_approved_per_hostel
  ON hostel_marketing_revisions (hostel_id)
  WHERE status = 'APPROVED';

-- The admin review queue: everything waiting, oldest first.
CREATE INDEX IF NOT EXISTS idx_hostel_marketing_pending
  ON hostel_marketing_revisions (status, submitted_at)
  WHERE status = 'PENDING_REVIEW';

CREATE INDEX IF NOT EXISTS idx_hostel_marketing_hostel_status
  ON hostel_marketing_revisions (hostel_id, status);
