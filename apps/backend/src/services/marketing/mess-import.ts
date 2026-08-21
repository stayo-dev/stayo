/**
 * Bringing the hostel's real kitchen menu into its listing.
 *
 * The listing keeps its **own reviewed copy** of the menu rather than reading
 * `food_schedules` live — that is ADR-077, and it holds: a food schedule is a
 * tenant-ops artifact regenerated every month, sometimes off a residents'
 * poll, while a published listing is a claim Stayo has reviewed and lent its
 * name to. Wiring one to the other would let the menu a tenant is shown before
 * moving in change with no review at all.
 *
 * What was missing was the bridge in between. An owner who already maintains a
 * weekly menu in the Food module had to retype all 28 cells into the listing,
 * so most simply left it empty. This copies it once, into the draft, where the
 * owner can edit it and send it through the normal review cycle.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

/** `food_schedule_meals` rows, as much of them as this needs. */
export interface ScheduleMeal {
  day_of_week: string;
  meal_type: string;
  item_name: string | null;
}

export type MessWeek = { b: string; l: string; s: string; dn: string }[];

const DAY_INDEX: Record<string, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};

/** The kitchen's four meals, in the listing's own keys. */
const MEAL_KEY: Record<string, "b" | "l" | "s" | "dn"> = {
  BREAKFAST: "b",
  LUNCH: "l",
  SNACKS: "s",
  DINNER: "dn",
};

export const EMPTY_WEEK: MessWeek = Array.from({ length: 7 }, () => ({ b: "", l: "", s: "", dn: "" }));

/**
 * A published schedule's 28 rows as the listing's 7×4 grid.
 *
 * Always exactly seven days, whatever the schedule holds: both surfaces index
 * the week positionally, so a short week would make Tuesday read as
 * `undefined`. Rows for an unknown day or meal are skipped rather than
 * guessed at.
 */
export function scheduleToMessWeek(meals: ScheduleMeal[]): MessWeek {
  const week: MessWeek = EMPTY_WEEK.map((day) => ({ ...day }));

  for (const meal of meals) {
    const dayIndex = DAY_INDEX[meal.day_of_week];
    const key = MEAL_KEY[meal.meal_type];
    if (dayIndex === undefined || !key) continue;
    week[dayIndex][key] = (meal.item_name ?? "").trim().slice(0, 200);
  }

  return week;
}

/** Which meals the kitchen actually serves, so the listing can switch off the rest. */
export function mealsServed(meals: ScheduleMeal[]): Record<"b" | "l" | "s" | "dn", boolean> {
  const served = { b: false, l: false, s: false, dn: false };
  for (const meal of meals) {
    const key = MEAL_KEY[meal.meal_type];
    if (key && (meal.item_name ?? "").trim()) served[key] = true;
  }
  return served;
}
