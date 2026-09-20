-- 089_hostel_slug_history.sql — ADR-226 Phase 2
--
-- A hostel's public slug is a promise. It is in Google's index, it is in
-- WhatsApp messages already sent, and it is the canonical URL every other
-- surface points at. Phase 3 renames slugs to the locality form
-- (`name-locality-id8`), so the old value has to keep resolving — forever,
-- not for a grace period.
--
-- This table ships BEFORE anything renames, so the redirect exists before
-- there is a retired slug to redirect. It is empty and inert until Phase 3
-- writes the first row.
--
-- NEW TABLE ONLY — no column is added to `hostels`, so there is no
-- unselected-read hazard here (see the 2026-08-22 `navigation` outage in
-- Bugs: declaring a column on a Prisma model changes every query that does
-- NOT name its columns). The `hostels.area_id` column in migration 090 is
-- the one that needs the strict apply-then-declare ordering.

CREATE TABLE IF NOT EXISTS public.hostel_slug_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id  uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  -- Globally unique, not unique-per-hostel: a retired slug must never be
  -- reachable for two different hostels, or a 301 becomes a wrong answer
  -- rather than a redirect.
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hostel_slug_history_hostel_idx
  ON public.hostel_slug_history (hostel_id, created_at DESC);

-- Deny-all to the anon/authenticated Supabase roles. The server reaches this
-- over the direct Postgres connection as table owner, which bypasses RLS;
-- leaving RLS off would expose it to PostgREST. Same lockdown pattern the OTP
-- tables use.
ALTER TABLE public.hostel_slug_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hostel_slug_history IS
  'Retired public_slug values. Every row 301s to the hostel''s current slug, permanently. ADR-226.';
