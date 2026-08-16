-- 068_platform_listings_and_review_flags.sql
--
-- Two things, both serving one artifact: an approved marketing revision
-- rendering on Discovery.
--
--  1. Stayo can list hostels it does not manage, so a tenant searching a city
--     finds what is there rather than only what signed up. Such a listing is
--     assignable to the real owner when they later join.
--  2. The admin review can flag SPECIFIC sections of a submitted marketing
--     page, so "send back" tells the owner what to fix rather than that
--     something, somewhere, was wrong.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Where a listing came from.
--
--    `owner_id` deliberately stays NOT NULL. A platform listing points at a
--    dedicated "Stayo Platform" profile until claimed. Making it nullable
--    would force every owner-scoped query in the codebase to handle a hostel
--    with nobody — and architectural-invariants-check.ts already forbids
--    treating hostel ownership as optional. One sentinel row keeps all of
--    that untouched.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ListingSource') THEN
    CREATE TYPE "ListingSource" AS ENUM ('OWNER_MANAGED', 'PLATFORM_LISTED');
  END IF;
END$$;

ALTER TABLE hostels
  ADD COLUMN IF NOT EXISTS listing_source "ListingSource" NOT NULL DEFAULT 'OWNER_MANAGED',
  ADD COLUMN IF NOT EXISTS claimed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by     UUID REFERENCES profiles (id) ON DELETE SET NULL;

COMMENT ON COLUMN hostels.listing_source IS
  'OWNER_MANAGED: a real owner operates this hostel in Stayo. PLATFORM_LISTED: Stayo authored the listing for coverage; nobody operates it here, so it has no real rooms and must never advertise live vacancy.';
COMMENT ON COLUMN hostels.claimed_at IS
  'When a PLATFORM_LISTED hostel was assigned to its real owner. Null while unclaimed.';

-- Unclaimed listings are queried as a set by the admin console.
CREATE INDEX IF NOT EXISTS idx_hostels_listing_source
  ON hostels (listing_source)
  WHERE listing_source = 'PLATFORM_LISTED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-section review flags on a marketing revision.
--
--    Shape: [{ "section": "photos", "note": "3 are blurry",
--              "flagged_by": "<uuid>", "flagged_at": "<iso>" }]
--
--    JSONB rather than a child table for the same reason the content itself is
--    JSONB (ADR-076): a revision is an immutable snapshot, and a child table
--    would need its own versioning to belong to one.
--
--    `review_note` is kept — it remains the overall message to the owner.
--    Flags are the specifics; the note is the covering sentence.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE hostel_marketing_revisions
  ADD COLUMN IF NOT EXISTS review_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN hostel_marketing_revisions.review_flags IS
  'Admin-authored, per-section objections: [{section, note, flagged_by, flagged_at}]. Distinct from the automated ReviewFlags computed by marketing-review-service.ts, which are advisory and never stored.';
