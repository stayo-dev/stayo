import type { MealSlotKey } from './weekGrid';
import type { MealTimings } from '@features/food/mealTimings';

/**
 * The kitchen's numbers, as a screen needs them. Pure: the copy rules and the
 * "is this meal loggable yet" decision are tested here, so the page only
 * renders. See docs/superpowers/specs/2026-09-14-meal-forecast-design.md
 * and ADR-195.
 */

export type MealType = 'BREAKFAST' | 'LUNCH' | 'SNACKS' | 'DINNER';
export type MealBasis = 'learned' | 'headcount';

export interface ForecastMealEntry {
  mealType: MealType;
  expected: number;
  basis: MealBasis;
  samples: number;
  ratio: number;
  headcount: number;
  served: number | null;
}

export interface ForecastDay {
  date: string;
  meals: ForecastMealEntry[];
}

export interface MealForecast {
  today: string;
  days: ForecastDay[];
}

/** The kitchen sheet speaks lowercase slots; the API speaks uppercase meal types. */
export const SLOT_TO_MEAL_TYPE: Record<MealSlotKey, MealType> = {
  breakfast: 'BREAKFAST',
  lunch: 'LUNCH',
  snacks: 'SNACKS',
  dinner: 'DINNER',
};

export function entryFor(forecast: MealForecast | undefined, date: string, slot: MealSlotKey): ForecastMealEntry | null {
  const day = forecast?.days.find((d) => d.date === date);
  return day?.meals.find((m) => m.mealType === SLOT_TO_MEAL_TYPE[slot]) ?? null;
}

/** "≈" is the whole honesty of the feature: it marks a number that was inferred. */
export function expectedLabel(entry: ForecastMealEntry): string {
  return entry.basis === 'learned' ? `≈ ${entry.expected}` : String(entry.expected);
}

export function honestyLine(entry: ForecastMealEntry): string {
  return entry.basis === 'learned' ? 'from the last 2 weeks' : 'still learning what people actually eat';
}

/**
 * Ask for a served count only once the meal has actually happened: after its
 * window closed today, or any time for an earlier day. A meal the hostel does
 * not serve is never asked about, and an already-logged number stays editable
 * because correcting a typo is the normal case.
 */
export function canLogNow(args: {
  entry: ForecastMealEntry | null;
  slot: MealSlotKey;
  timings: MealTimings;
  nowHHmm: string;
  isToday: boolean;
}): boolean {
  if (!args.entry) return false;
  const timing = args.timings[SLOT_TO_MEAL_TYPE[args.slot]];
  if (!timing?.enabled) return false;
  if (!args.isToday) return true;
  return args.nowHHmm >= timing.end;
}
