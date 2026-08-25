-- 076_hostel_review_categories_v2.sql
--
-- Moves hostel_reviews from Airbnb's six generic categories to eight
-- hostel-specific ones, and from a derived overall star to a separately
-- collected one.
--
-- Category change: `rating_value` and `rating_location` drop (a hostel is a
-- place you live for a year, not a holiday flat you compare on location and
-- price). `rating_maintenance`, `rating_room_comfort`, `rating_amenities` and
-- `rating_wifi` arrive — the things residents actually argue about that the
-- original six missed. `rating_cleanliness`, `rating_food`, `rating_safety`
-- and `rating_staff` (now labelled "Staff & Management" in the app, same
-- column) carry over unchanged.
--
-- Overall change: `rating` stops being computed as the mean of the category
-- columns and becomes a value the resident gives directly, alongside the
-- categories rather than derived from them. No column change — the meaning
-- of what is written into it changes at the service layer, not the schema.
--
-- `stay_months` is new: the stay duration snapshotted at submit time, same
-- philosophy as `stayed_here` — a live join against the tenancy would drift
-- after the tenancy itself changes, and the badge is describing the stay the
-- review is about, not the account's current status.
--
-- Status gains a fourth value, CHANGES_REQUESTED, so a moderator can ask for
-- a rewrite distinctly from an outright rejection.

ALTER TABLE hostel_reviews DROP CONSTRAINT IF EXISTS hostel_reviews_category_range;

ALTER TABLE hostel_reviews
  DROP COLUMN IF EXISTS rating_value,
  DROP COLUMN IF EXISTS rating_location;

ALTER TABLE hostel_reviews
  ADD COLUMN IF NOT EXISTS rating_maintenance  smallint,
  ADD COLUMN IF NOT EXISTS rating_room_comfort smallint,
  ADD COLUMN IF NOT EXISTS rating_amenities    smallint,
  ADD COLUMN IF NOT EXISTS rating_wifi         smallint,
  ADD COLUMN IF NOT EXISTS stay_months         smallint;

ALTER TABLE hostel_reviews ADD CONSTRAINT hostel_reviews_category_range_v2 CHECK (
  (rating_cleanliness  IS NULL OR rating_cleanliness  BETWEEN 1 AND 5) AND
  (rating_maintenance  IS NULL OR rating_maintenance  BETWEEN 1 AND 5) AND
  (rating_food         IS NULL OR rating_food         BETWEEN 1 AND 5) AND
  (rating_room_comfort IS NULL OR rating_room_comfort BETWEEN 1 AND 5) AND
  (rating_amenities    IS NULL OR rating_amenities    BETWEEN 1 AND 5) AND
  (rating_staff        IS NULL OR rating_staff        BETWEEN 1 AND 5) AND
  (rating_safety       IS NULL OR rating_safety       BETWEEN 1 AND 5) AND
  (rating_wifi         IS NULL OR rating_wifi         BETWEEN 1 AND 5)
);

ALTER TABLE hostel_reviews DROP CONSTRAINT IF EXISTS hostel_reviews_status_check;
ALTER TABLE hostel_reviews ADD CONSTRAINT hostel_reviews_status_check
  CHECK (status IN ('PENDING', 'PUBLISHED', 'REJECTED', 'CHANGES_REQUESTED'));

-- Automatic topic + sentiment detection on a review's free-text body. Distinct
-- from the resident-given category stars above: a resident rates Wi-Fi with
-- their thumb, this table is what the system inferred from what they typed.
-- One review can produce several rows — a comment naming three topics is
-- three rows, not one. Never read by the moderation decision path: sentiment
-- here is an admin-insight signal, not a publish/reject gate.
CREATE TABLE IF NOT EXISTS hostel_review_topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid NOT NULL REFERENCES hostel_reviews(id) ON DELETE CASCADE,
  category    text NOT NULL,
  sentiment   text NOT NULL CHECK (sentiment IN ('POSITIVE', 'NEUTRAL', 'NEGATIVE')),
  confidence  real NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hostel_review_topics_review
  ON hostel_review_topics (review_id);

-- The admin insights view reads "everything about Wi-Fi, negative only".
CREATE INDEX IF NOT EXISTS idx_hostel_review_topics_category_sentiment
  ON hostel_review_topics (category, sentiment);
