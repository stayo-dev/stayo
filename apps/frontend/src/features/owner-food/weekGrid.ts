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

export interface WeekGridCell {
  /** The `food_schedule_meals` row id, or null for a cell that has no row yet. */
  id: string | null;
  day_of_week: DayKey;
  meal_type: MealSlotKey;
  menu_item_id: string | null;
  item_name: string;
}

export type WeekGrid = WeekGridCell[];

interface RawMeal {
  id?: string;
  day_of_week: string;
  meal_type: string;
  menu_item_id?: string | null;
  item_name?: string | null;
}

/**
 * Default meal times. Deliberately not stored anywhere yet — four sensible
 * defaults beat a settings screen nobody asked for. If these need to become
 * per-hostel, `preferences_config` already exists for exactly this kind of
 * setting; no new table.
 */
export const MEAL_TIMES: Record<MealSlotKey, { hour: number; label: string }> = {
  breakfast: { hour: 8, label: '8:00am' },
  lunch: { hour: 13, label: '1:00pm' },
  snacks: { hour: 17, label: '5:00pm' },
  dinner: { hour: 20, label: '8:00pm' },
};

const DAY_SET = new Set<string>(DAY_ORDER);
const SLOT_SET = new Set<string>(SLOT_ORDER);

export function toWeekGrid(meals: RawMeal[] | null | undefined): WeekGrid {
  if (!meals) return [];
  const out: WeekGrid = [];
  for (const meal of meals) {
    const slot = String(meal.meal_type ?? '').toLowerCase();
    const day = String(meal.day_of_week ?? '');
    if (!DAY_SET.has(day) || !SLOT_SET.has(slot)) continue;
    out.push({
      id: meal.id ?? null,
      day_of_week: day as DayKey,
      meal_type: slot as MealSlotKey,
      menu_item_id: meal.menu_item_id ?? null,
      item_name: meal.item_name ?? 'Not set',
    });
  }
  return out;
}

/** JS `getDay()` is Sunday-first; the grid is Monday-first. */
export function dayKeyFor(date: Date): DayKey {
  const jsDay = date.getDay();
  return DAY_ORDER[(jsDay + 6) % 7];
}

export function cellAt(grid: WeekGrid, day: DayKey, slot: MealSlotKey): WeekGridCell | null {
  return grid.find((c) => c.day_of_week === day && c.meal_type === slot) ?? null;
}

/** A cell counts as filled only when it names a real item — the generator writes "Not set" for an empty library. */
export function isFilled(cell: WeekGridCell | null | undefined): boolean {
  return Boolean(cell && cell.menu_item_id && cell.item_name && cell.item_name !== 'Not set');
}

export function dayCompleteness(grid: WeekGrid, day: DayKey): 'COMPLETE' | 'PARTIAL' | 'EMPTY' {
  const filled = SLOT_ORDER.filter((slot) => isFilled(cellAt(grid, day, slot))).length;
  if (filled === SLOT_ORDER.length) return 'COMPLETE';
  return filled === 0 ? 'EMPTY' : 'PARTIAL';
}

/**
 * Which meal the owner is most likely asking about right now, and what follows.
 * Before the first meal of the day, breakfast is still "current" — at 2am the
 * useful answer is what's coming, not yesterday's dinner.
 */
export function mealSlotAt(now: Date): { current: MealSlotKey; next: MealSlotKey | null } {
  const hour = now.getHours() + now.getMinutes() / 60;
  let currentIndex = 0;
  for (let i = 0; i < SLOT_ORDER.length; i++) {
    if (hour >= MEAL_TIMES[SLOT_ORDER[i]].hour) currentIndex = i;
  }
  return {
    current: SLOT_ORDER[currentIndex],
    next: currentIndex + 1 < SLOT_ORDER.length ? SLOT_ORDER[currentIndex + 1] : null,
  };
}
