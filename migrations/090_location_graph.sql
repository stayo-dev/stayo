-- 090_location_graph.sql — ADR-226 Phase 3
--
-- The geographic knowledge graph the locality engine is built on:
--
--     Hyderabad → Ghatkesar → Yamnampet → SNIST → Sri Adithya Boys Hostel
--
-- Until now Stayo had NO location model at all: no lat/lng anywhere, no
-- colleges table, no hostel↔college relation, and no locality column. The
-- only structured location data was an admin-entered Google Place ID plus a
-- free-text landmark on `hostels.navigation`. Locality and college pages
-- cannot exist without this.
--
-- ┌──────────────────────────────────────────────────────────────────────┐
-- │ DEPLOY ORDER IS LOAD-BEARING. READ BEFORE APPLYING.                  │
-- │                                                                      │
-- │ `hostels.area_id` is a new column on an existing, heavily-read       │
-- │ table. Declaring it in schema.prisma makes Prisma request it on      │
-- │ every query that does NOT pass an explicit `select` — and this       │
-- │ codebase has ~10 `include:`-only reads of `hostels`, one of which is │
-- │ `admissionsService.getPublicHostel`. Declaring before the column     │
-- │ exists is exactly the 2026-08-22 outage that took down every listing │
-- │ detail page with "column t1.navigation does not exist".              │
-- │                                                                      │
-- │   1. Apply THIS FILE to the database.                                │
-- │   2. Verify:                                                         │
-- │        SELECT column_name FROM information_schema.columns            │
-- │         WHERE table_schema='public' AND table_name='hostels'         │
-- │           AND column_name='area_id';                                 │
-- │      Do not continue on an empty result.                             │
-- │   3. ONLY THEN declare `area_id` in schema.prisma and ship code.     │
-- │                                                                      │
-- │ The three new tables carry no such hazard. Relation fields added to  │
-- │ `hostels` are not columns and are not requested on unselected reads; │
-- │ only the `area_id` scalar is.                                        │
-- └──────────────────────────────────────────────────────────────────────┘

-- ── areas ────────────────────────────────────────────────────────────────
-- Self-referencing on purpose: a city is just an area with no parent. One
-- table, one route and one generator serve Hyderabad, Ghatkesar and
-- Yamnampet alike, and the hierarchy can deepen without a schema change.
CREATE TABLE IF NOT EXISTS public.areas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  -- 'CITY' | 'LOCALITY'. Plain text, matching this schema's convention of
  -- keeping status-ish columns as strings rather than Postgres enums.
  kind         text NOT NULL DEFAULT 'LOCALITY',
  parent_id    uuid REFERENCES public.areas(id) ON DELETE SET NULL,
  state        text,
  -- Admin-written editorial. NULL is normal and renders nothing — it is what
  -- stops two locality pages reading like the same template twice.
  intro        text,
  is_published boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS areas_parent_idx ON public.areas (parent_id, name);
CREATE INDEX IF NOT EXISTS areas_published_idx ON public.areas (is_published, kind);

-- ── colleges ─────────────────────────────────────────────────────────────
-- Students search the campus before the locality, so this is the highest-
-- intent entity in the graph.
CREATE TABLE IF NOT EXISTS public.colleges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  -- "SNIST". What a student types, and what the hostel's own navigation
  -- data already records — so it, not the full name, drives the slug.
  short_name   text,
  area_id      uuid REFERENCES public.areas(id) ON DELETE SET NULL,
  intro        text,
  is_published boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS colleges_area_idx ON public.colleges (area_id, name);

-- ── hostel_colleges ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hostel_colleges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id     uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  college_id    uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  -- FREE TEXT, deliberately: "400 m", "5 min walk". ADR-088 keeps distance
  -- free text because a numeric metres column invites a precision nobody
  -- measured. It is rendered on the page and never lifted into a structured
  -- numeric property.
  distance_text text,
  -- Curated ordering for "nearest first". NULL sorts last.
  distance_rank integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hostel_id, college_id)
);

CREATE INDEX IF NOT EXISTS hostel_colleges_college_idx
  ON public.hostel_colleges (college_id, distance_rank);

-- ── hostels.area_id ──────────────────────────────────────────────────────
-- THE HAZARDOUS ONE. See the box at the top of this file.
ALTER TABLE public.hostels
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hostels_area_idx ON public.hostels (area_id);

-- ── RLS: deny-all to anon/authenticated ──────────────────────────────────
ALTER TABLE public.areas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colleges        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hostel_colleges ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.areas IS
  'Geographic hierarchy: a CITY has no parent, a LOCALITY points at its parent area. ADR-226.';
COMMENT ON TABLE public.colleges IS
  'Campuses hostels are searched relative to. ADR-226.';
COMMENT ON TABLE public.hostel_colleges IS
  'Which hostels are near which campus, with a free-text distance. ADR-226.';
