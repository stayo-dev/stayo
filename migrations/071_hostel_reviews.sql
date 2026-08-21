-- 071_hostel_reviews.sql
--
-- Resident reviews on a hostel's Discovery listing.
--
-- Discovery has always returned `ratings_available: false` and reserved the
-- space rather than inventing a number (phases C/D of the discovery design).
-- This is that column arriving.
--
-- The design point: **a review is not public until an admin publishes it.**
-- A public text field attached to a real business, with the business's name on
-- it, is not something to publish unread. See ADR-086.

CREATE TABLE IF NOT EXISTS hostel_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id       uuid NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body            text,

  -- PENDING | PUBLISHED | REJECTED
  status          text NOT NULL DEFAULT 'PENDING',

  -- Snapshotted at submit time: has this person ever held a tenancy here.
  -- A signal for the moderator and a badge on the review, never a gate.
  stayed_here     boolean NOT NULL DEFAULT false,

  moderated_at    timestamptz,
  moderated_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  moderation_note text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,

  CONSTRAINT hostel_reviews_status_check CHECK (status IN ('PENDING', 'PUBLISHED', 'REJECTED'))
);

-- One review per person per hostel. An edit replaces it (and returns it to the
-- queue) rather than stacking a second opinion from the same account.
CREATE UNIQUE INDEX IF NOT EXISTS hostel_reviews_hostel_profile_key
  ON hostel_reviews (hostel_id, profile_id);

-- The listing reads published reviews for one hostel.
CREATE INDEX IF NOT EXISTS idx_hostel_reviews_hostel_status
  ON hostel_reviews (hostel_id, status);

-- The admin queue reads everything pending, oldest first.
CREATE INDEX IF NOT EXISTS idx_hostel_reviews_status_created
  ON hostel_reviews (status, created_at DESC);
