-- Multiple food items per scheduled meal cell.
--
-- Adds `food_schedule_meal_items`, a child table under `food_schedule_meals`
-- so one day+meal cell (still exactly one row, unique constraint unchanged)
-- can hold an ordered list of dishes instead of exactly one.
--
-- `food_schedule_meals.menu_item_id`/`.item_name` are NOT dropped — they stay
-- as an auto-maintained legacy cache (first item id / comma-joined names)
-- because `src/services/marketing/mess-import.ts` reads `item_name` directly
-- for a one-time copy into the Discovery listing's mess-menu draft (ADR-077)
-- and is out of scope for this change.
--
-- Idempotent, matching the `20260808130000_add_food_polls` precedent:
-- `CREATE TABLE IF NOT EXISTS`, FK adds wrapped in
-- `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` — this repo
-- applies schema changes via `prisma db push`, not `migrate deploy`, so this
-- file is the historical record of what `db push` applied.

CREATE TABLE IF NOT EXISTS "food_schedule_meal_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_meal_id" UUID NOT NULL,
    "menu_item_id" UUID,
    "item_name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "food_schedule_meal_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "food_schedule_meal_items_schedule_meal_id_display_order_key" ON "food_schedule_meal_items"("schedule_meal_id", "display_order");
CREATE INDEX IF NOT EXISTS "food_schedule_meal_items_schedule_meal_id_idx" ON "food_schedule_meal_items"("schedule_meal_id");

DO $$ BEGIN
  ALTER TABLE "food_schedule_meal_items" ADD CONSTRAINT "food_schedule_meal_items_schedule_meal_id_fkey" FOREIGN KEY ("schedule_meal_id") REFERENCES "food_schedule_meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "food_schedule_meal_items" ADD CONSTRAINT "food_schedule_meal_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "food_menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: every existing single-item `food_schedule_meals` row becomes one
-- child row at display_order 0. Excludes the generator's true-empty sentinel
-- (item_name = 'Not set' with no menu_item_id) so we don't fabricate a fake
-- dish. Guarded by NOT EXISTS so this is safe to re-run.
--
-- NOTE: `prisma db push` only diffs schema (DDL) — it will NOT execute this
-- INSERT. Run it as an explicit separate step against the same database
-- after `db push` has created the table above.
INSERT INTO food_schedule_meal_items (id, schedule_meal_id, menu_item_id, item_name, display_order, created_at)
SELECT gen_random_uuid(), fsm.id, fsm.menu_item_id, fsm.item_name, 0, now()
FROM food_schedule_meals fsm
WHERE NOT (fsm.item_name = 'Not set' AND fsm.menu_item_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM food_schedule_meal_items x WHERE x.schedule_meal_id = fsm.id);
