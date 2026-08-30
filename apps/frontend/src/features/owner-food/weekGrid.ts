import type { MealSlotKey } from '@shared/mocks/food';

/**
 * The one shape every week-reader consumes.
 *
 * Nothing may read `food_schedules` rows directly. A week has several
 * producers today — generation, carry-forward, manual edits — and will gain
 * another (saved templates: Exam Week, Festival, Holiday) without any consumer
 * changing, because they all hand back a `WeekGrid`.
 *
 * See `docs/design/food-module-redesign.md` §8.1.
 */

export const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type DayKey = (typeof DAY_ORDER)[number];

export const SLOT_ORDER: MealSlotKey[] = ['breakfast', 'lunch', 'snacks', 'dinner'];

export interface WeekGridItem {
  id: string;
  menu_item_id: string | null;
  item_name: string;
  display_order: number;
}

export interface WeekGridCell {
  /** The `food_schedule_meals` row id, or null for a cell that has no row yet. */
  id: string | null;
  day_of_week: DayKey;
  meal_type: MealSlotKey;
  /**
   * The cell row's `updated_at`, as last read from the server — the value the
   * Timetable page's edits send back as `expectedUpdatedAt` so a stale write
   * from another tab is rejected rather than silently applied (ADR-114).
   * `null` for a cell that has no row yet.
   */
  updated_at: string | null;
  /** Ordered dishes for this cell — the real, multi-item content. Every real consumer reads this, not the fields below. */
  items: WeekGridItem[];
  /**
   * @deprecated Legacy single-item snapshot, derived from `items` for
   * anything reading this shape that hasn't been migrated. Do not add new
   * reads of these — use `items`/`formatCellItems` instead.
   */
  menu_item_id: string | null;
  /** @deprecated see `menu_item_id` above. */
  item_name: string;
}

export type WeekGrid = WeekGridCell[];

interface RawMealItem {
  id: string;
  menu_item_id?: string | null;
  item_name?: string | null;
  display_order?: number | null;
}

interface RawMeal {
  id?: string;
  day_of_week: string;
  meal_type: string;
  updated_at?: string | null;
  menu_item_id?: string | null;
  item_name?: string | null;
  food_schedule_meal_items?: RawMealItem[] | null;
}

/**
 * The one word every surface uses for a cell with no meal in it — and the
 * literal string the generator writes when a meal type's library is empty,
 * which is why `isFilled` has to recognise it. Surfaces used to spell this
 * three different ways ("Empty", "Not set", "not set") for the same state.
 */
export const EMPTY_CELL_LABEL = 'Not set';

const DAY_SET = new Set<string>(DAY_ORDER);
const SLOT_SET = new Set<string>(SLOT_ORDER);

export function toWeekGrid(meals: RawMeal[] | null | undefined): WeekGrid {
  if (!meals) return [];
  const out: WeekGrid = [];
  for (const meal of meals) {
    const slot = String(meal.meal_type ?? '').toLowerCase();
    const day = String(meal.day_of_week ?? '');
    if (!DAY_SET.has(day) || !SLOT_SET.has(slot)) continue;
    const items: WeekGridItem[] = (meal.food_schedule_meal_items ?? [])
      .slice()
      .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
      .map((item) => ({
        id: item.id,
        menu_item_id: item.menu_item_id ?? null,
        item_name: item.item_name ?? '',
        display_order: item.display_order ?? 0,
      }));
    out.push({
      id: meal.id ?? null,
      day_of_week: day as DayKey,
      meal_type: slot as MealSlotKey,
      updated_at: meal.updated_at ?? null,
      items,
      menu_item_id: items[0]?.menu_item_id ?? meal.menu_item_id ?? null,
      item_name: items.length > 0 ? items.map((i) => i.item_name).join(', ') : (meal.item_name ?? EMPTY_CELL_LABEL),
    });
  }
  return out;
}

/**
 * The shared display string every surface uses for a cell's dishes —
 * `"Rice • Dal • Curry • Chutney"`, or the shared empty label. Takes just
 * `{ items }` rather than a full `WeekGridCell` so it also works for the
 * tenant hook's own cell shape, which carries the same `items` array without
 * the rest of `WeekGridCell`'s fields.
 */
export function formatCellItems(cell: { items: WeekGridItem[] } | null | undefined, separator = ' • '): string {
  if (!cell || cell.items.length === 0) return EMPTY_CELL_LABEL;
  return cell.items.map((i) => i.item_name).join(separator);
}

/**
 * An order-independent key for "which dishes does this cell hold" — used by
 * `publishChecks.ts`'s "dominant item"/"repeats on consecutive days" checks,
 * which are about what's being served, not what order it's listed in. Falls
 * back to the item's name when its library link was deleted (`menu_item_id`
 * null via `onDelete: SetNull`), so two orphaned same-named items still match.
 * Empty cells all share one key so they never register as "the same meal
 * repeating" — an empty slot repeating isn't a variety problem.
 */
export function itemSetKey(cell: WeekGridCell | null | undefined): string {
  if (!cell || cell.items.length === 0) return '__empty__';
  return cell.items
    .map((i) => i.menu_item_id ?? `name:${i.item_name}`)
    .sort()
    .join('|');
}

/** Whether two cells hold the same dishes, ignoring display order. */
export function sameItemSet(a: WeekGridCell | null | undefined, b: WeekGridCell | null | undefined): boolean {
  if (!isFilled(a) || !isFilled(b)) return false;
  return itemSetKey(a) === itemSetKey(b);
}

/** JS `getDay()` is Sunday-first; the grid is Monday-first. */
export function dayKeyFor(date: Date): DayKey {
  const jsDay = date.getDay();
  return DAY_ORDER[(jsDay + 6) % 7];
}

export function cellAt(grid: WeekGrid, day: DayKey, slot: MealSlotKey): WeekGridCell | null {
  return grid.find((c) => c.day_of_week === day && c.meal_type === slot) ?? null;
}

/** A cell counts as filled only when it holds at least one real dish. */
/**
 * The meal slots this hostel actually serves, judged by the week in front of
 * us: a slot with nothing planned on any of the seven days is one the kitchen
 * does not run.
 *
 * Used to drop a whole column or row rather than print it as seven dashes.
 * A hostel that serves no evening snack should not have "Snacks —" repeated
 * down a sheet on its canteen wall; that reads as an unfinished menu, which is
 * exactly the impression a wall chart must not give. An individual gap in a
 * slot the hostel *does* serve still shows a dash, because there the absence
 * is real information — that meal is genuinely unplanned.
 *
 * Order is preserved from `SLOT_ORDER`. Everything empty returns everything,
 * deliberately: a schedule nobody has started is a blank week to fill in, not
 * a hostel that serves no food at all. See ADR-147.
 */
export function slotsInUse(grid: WeekGrid): MealSlotKey[] {
  const used = SLOT_ORDER.filter((slot) =>
    DAY_ORDER.some((day) => isFilled(cellAt(grid, day, slot))),
  );
  return used.length > 0 ? used : [...SLOT_ORDER];
}

export function isFilled(cell: WeekGridCell | null | undefined): boolean {
  return Boolean(cell && cell.items.length > 0);
}

export function dayCompleteness(grid: WeekGrid, day: DayKey): 'COMPLETE' | 'PARTIAL' | 'EMPTY' {
  const filled = SLOT_ORDER.filter((slot) => isFilled(cellAt(grid, day, slot))).length;
  if (filled === SLOT_ORDER.length) return 'COMPLETE';
  return filled === 0 ? 'EMPTY' : 'PARTIAL';
}

/**
 * "Which meal is current/next" now lives in `features/food/mealTimings.ts`
 * (`currentAndNextMeal`), driven by real per-hostel `preferences_config`
 * timings instead of a hardcoded hour — see ADR on Meal Timings.
 */
