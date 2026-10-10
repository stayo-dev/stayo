-- 096_special_meals.sql
--
-- Special-meal choices, Phase 1 (spec: docs/superpowers/specs/2026-10-10-special-meal-choices-design.md).
-- A hostel's recurring special meal (e.g. Sunday lunch, cooked veg and non-veg)
-- and each resident's answer for one dated serving of it.
--
-- NEW TABLES ONLY, with no foreign key *declared in Prisma*: adding a relation
-- field to tenants/hostels would change existing models, which is the
-- deploy-before-migrate hazard of 2026-08-22. The database still enforces the
-- references below.
--
-- Dietary choice can reveal religion or caste, so both tables are closed to the
-- anon/authenticated roles outright; only the backend's service connection reads them.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.

CREATE TABLE IF NOT EXISTS public.special_meal_occasions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id             uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  owner_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday, the same as lib/timezone.ts weekdayOfIso().
  weekday               smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  meal_type             text NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER')),
  -- Optional dish names for the question ("Chicken Biryani or Veg Biryani").
  veg_dish              text CHECK (veg_dish IS NULL OR char_length(veg_dish) <= 60),
  non_veg_dish          text CHECK (non_veg_dish IS NULL OR char_length(non_veg_dish) <= 60),
  -- Answers close this many minutes before the meal's serving window opens.
  cutoff_minutes_before integer NOT NULL DEFAULT 180 CHECK (cutoff_minutes_before BETWEEN 0 AND 1440),
  -- LAST_CHOICE: a silent tenant is cooked for as their last explicit veg/non-veg.
  -- LEAVE_OUT: a silent tenant is not cooked for.
  no_answer_policy      text NOT NULL DEFAULT 'LAST_CHOICE' CHECK (no_answer_policy IN ('LAST_CHOICE', 'LEAVE_OUT')),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT special_meal_occasions_hostel_day_meal_key UNIQUE (hostel_id, weekday, meal_type)
);

CREATE INDEX IF NOT EXISTS special_meal_occasions_weekday_active_idx
  ON public.special_meal_occasions (weekday) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.special_meal_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occasion_id  uuid NOT NULL REFERENCES public.special_meal_occasions(id) ON DELETE CASCADE,
  hostel_id    uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The IST calendar date of the serving.
  serve_date   date NOT NULL,
  choice       text NOT NULL CHECK (choice IN ('VEG', 'NON_VEG', 'AWAY', 'SKIP')),
  source       text NOT NULL CHECK (source IN ('WHATSAPP', 'OWNER')),
  -- The owner profile for an OWNER edit; null for the tenant's own tap.
  recorded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- The latest answer replaces the earlier one: one truth per tenant per serving.
  CONSTRAINT special_meal_answers_occasion_date_tenant_key UNIQUE (occasion_id, serve_date, tenant_id)
);

CREATE INDEX IF NOT EXISTS special_meal_answers_history_idx
  ON public.special_meal_answers (occasion_id, tenant_id, serve_date DESC);

-- "Food's ready" WhatsApp alerts. One row per occasion, serving and choice,
-- inserted BEFORE any message goes out: the unique key is what stops a
-- double-tapped button (or two devices) from pinging residents twice.
CREATE TABLE IF NOT EXISTS public.special_meal_ready_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occasion_id  uuid NOT NULL REFERENCES public.special_meal_occasions(id) ON DELETE CASCADE,
  hostel_id    uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  serve_date   date NOT NULL,
  choice       text NOT NULL CHECK (choice IN ('VEG', 'NON_VEG')),
  -- The owner profile that pressed the button.
  sent_by      uuid,
  -- How many residents were messaged; filled in once the sends finish.
  recipients   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT special_meal_ready_alerts_occasion_date_choice_key UNIQUE (occasion_id, serve_date, choice)
);

ALTER TABLE public.special_meal_occasions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_meal_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.special_meal_occasions FROM anon, authenticated;
REVOKE ALL ON public.special_meal_answers FROM anon, authenticated;
ALTER TABLE public.special_meal_ready_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.special_meal_ready_alerts FROM anon, authenticated;
