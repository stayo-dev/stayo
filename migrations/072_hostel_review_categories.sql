-- 072_hostel_review_categories.sql
--
-- Per-category ratings on a review, in Airbnb's shape: an overall score is
-- what a card shows, but "4.2" tells a reader nothing about *why*. A hostel is
-- judged on different things than a holiday flat, so the categories are the
-- ones residents actually argue about — food above all.
--
-- Every column is nullable: `food` does not apply to a hostel that serves no
-- meals, and a review written before this migration has none of them. The
-- summary averages each category over the reviews that answered it rather than
-- treating an unanswered category as a zero.

ALTER TABLE hostel_reviews
  ADD COLUMN IF NOT EXISTS rating_cleanliness smallint,
  ADD COLUMN IF NOT EXISTS rating_food        smallint,
  ADD COLUMN IF NOT EXISTS rating_safety      smallint,
  ADD COLUMN IF NOT EXISTS rating_staff       smallint,
  ADD COLUMN IF NOT EXISTS rating_value       smallint,
  ADD COLUMN IF NOT EXISTS rating_location    smallint;

DO $$
BEGIN
  -- Same 1–5 scale as the overall rating, enforced in the database rather than
  -- only in the service.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hostel_reviews_category_range') THEN
    ALTER TABLE hostel_reviews ADD CONSTRAINT hostel_reviews_category_range CHECK (
      (rating_cleanliness IS NULL OR rating_cleanliness BETWEEN 1 AND 5) AND
      (rating_food        IS NULL OR rating_food        BETWEEN 1 AND 5) AND
      (rating_safety      IS NULL OR rating_safety      BETWEEN 1 AND 5) AND
      (rating_staff       IS NULL OR rating_staff       BETWEEN 1 AND 5) AND
      (rating_value       IS NULL OR rating_value       BETWEEN 1 AND 5) AND
      (rating_location    IS NULL OR rating_location    BETWEEN 1 AND 5)
    );
  END IF;
END $$;
