-- 086_coverage_requests.sql — ADR-223
--
-- Two kinds of supply signal from the public homepage:
--   AREA   — "I'm looking near <campus> and Stayo has nothing there."
--   HOSTEL — "This hostel should be on Stayo", optionally with the owner's number.
--
-- Deliberately NOT visitor_leads rows. That model requires a non-null hostel_id
-- AND owner_id, and the whole point of both kinds is that neither exists yet.
-- These are demand signals, and they are what recruits owners into a city.

CREATE TABLE IF NOT EXISTS public.coverage_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL DEFAULT 'AREA',
  area_query        text,
  normalized_query  text,
  hostel_name       text,
  owner_contact     text,
  city              text,
  contact_phone     text,
  contact_email     text,
  seeker_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'HOME',
  notified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Each kind carries its own required payload; neither may be half-filled.
  CONSTRAINT coverage_requests_kind_payload CHECK (
    (kind = 'AREA'   AND area_query IS NOT NULL AND normalized_query IS NOT NULL) OR
    (kind = 'HOSTEL' AND hostel_name IS NOT NULL)
  )
);

-- Aggregation is always "how much demand for this area / this city / this kind,
-- lately", which is what the owner-facing readout in phase 2 will ask for.
CREATE INDEX IF NOT EXISTS idx_coverage_requests_normalized
  ON public.coverage_requests (normalized_query, created_at DESC) WHERE normalized_query IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_requests_city
  ON public.coverage_requests (city, created_at DESC) WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_requests_kind
  ON public.coverage_requests (kind, created_at DESC);

-- No unique constraint, deliberately: a student asking twice is signal, not
-- duplication, and de-duplication is a reporting concern. Abuse is handled by
-- the endpoint's rate limit and length caps, not by a constraint that would
-- throw away genuine repeat demand.
