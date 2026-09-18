-- 088_homepage_features.sql — ADR-223
--
-- Which hostels the public homepage shows, and in what order, is an admin
-- decision — not "whatever the recommended sort happened to return".
--
-- A separate table rather than a column on `hostels`, for three reasons:
-- curation is its own axis (ADR-040 reserves listing_status/verification_status
-- to admin and this must not be confused with them); it carries who curated and
-- when; and adding a column to `hostels` has taken production down before (see
-- the deploy-before-migrate rule in Bugs).
--
-- Being listed here is NOT a bypass of the DISCOVERABLE predicate. The read
-- path intersects this list with it, so a suspended or unverified hostel
-- silently drops off the homepage instead of 404ing from it.

CREATE TABLE IF NOT EXISTS public.homepage_features (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id  uuid NOT NULL UNIQUE REFERENCES public.hostels(id) ON DELETE CASCADE,
  -- Not unique: reordering rewrites the whole list, and a unique constraint
  -- would force temporary values for every swap.
  position   integer NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_homepage_features_position
  ON public.homepage_features (position ASC, created_at ASC);
