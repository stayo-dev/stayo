-- Meal forecast (Phase 2a, ADR-194): what the kitchen actually served.
--
-- The ground truth a forecast is learned from. Unlike `stay_events` this is a
-- MEASUREMENT, not an event log: re-entering a number corrects it, because a
-- cook fixing a typo is normal and there is only ever one truth per meal.
--
-- `headcount_at_log` is frozen at entry on purpose — the `stay_leaves`
-- projection keeps moving, and a leave cancelled next week must not silently
-- rewrite last Tuesday's ratio.
--
-- NEW table only; no existing table or column changes, so no read of any other
-- model is affected by deploy/migrate order. Idempotent.

CREATE TABLE IF NOT EXISTS "meal_service_logs" (
  "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
  "hostel_id"        UUID           NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  "serve_date"       DATE           NOT NULL,
  "meal_type"        TEXT           NOT NULL,
  "served_count"     INTEGER        NOT NULL,
  "headcount_at_log" INTEGER        NOT NULL,
  "recorded_by"      UUID,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "meal_service_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meal_service_logs_served_count_check" CHECK ("served_count" >= 0),
  CONSTRAINT "meal_service_logs_headcount_check" CHECK ("headcount_at_log" >= 0)
);

-- One truth per hostel, per date, per meal. This is what makes re-entry a
-- correction rather than a second opinion.
CREATE UNIQUE INDEX IF NOT EXISTS "meal_service_logs_hostel_date_meal_key"
  ON "meal_service_logs" ("hostel_id", "serve_date", "meal_type");
-- The exact shape of the ratio query: newest first, per hostel and meal.
CREATE INDEX IF NOT EXISTS "meal_service_logs_hostel_meal_date_idx"
  ON "meal_service_logs" ("hostel_id", "meal_type", "serve_date" DESC);

-- Backend-only table: RLS on with no policies, like the Stay tables.
ALTER TABLE "meal_service_logs" ENABLE ROW LEVEL SECURITY;
