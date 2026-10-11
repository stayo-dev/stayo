-- 097_special_meals_many_per_meal.sql
--
-- Special-meal choices (ADR-238): allow more than one special at the same meal
-- on the same day (e.g. Sunday lunch: Chicken vs Veg Biryani, AND Sunday
-- lunch: Mutton vs Fish curry). Each special keeps its own question, answers,
-- count and "food's ready" alert, all keyed by the occasion id, so nothing
-- else depended on the old one-per-day-and-meal rule.
--
-- Residents tell two specials at the same meal apart by their dishes, so the
-- service requires dish names when a second one is added (not a DB rule).
--
-- Safe in either deploy order: code that still expects the key only turns a
-- duplicate into a 409, and the new code never relies on it.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.

ALTER TABLE public.special_meal_occasions
  DROP CONSTRAINT IF EXISTS special_meal_occasions_hostel_day_meal_key;

CREATE INDEX IF NOT EXISTS special_meal_occasions_hostel_day_idx
  ON public.special_meal_occasions (hostel_id, weekday);
