import { SLOT_ORDER } from '@features/owner-food/weekGrid';
import type { MealSlotKey } from '@shared/mocks/food';

/**
 * Owner-configured serving windows — permanent hostel config, read by the
 * owner Meal Timings screen, the weekly schedule grid header, and both
 * tenant Food/Home pages. Never re-entered per meal or per day; this is the
 * one source every surface reads.
 */
export interface MealTimingEntry {
  start: string; // "HH:mm", 24h
  end: string; // "HH:mm", 24h
  enabled: boolean;
}

export type MealTimings = Record<MealSlotKey, MealTimingEntry>;

/** Mirrors the backend's `DEFAULT_MEAL_TIMINGS` — a loading-state fallback only, never a silent stand-in for a failed fetch. */
export const DEFAULT_MEAL_TIMINGS: MealTimings = {
  breakfast: { start: '07:00', end: '09:00', enabled: true },
  lunch: { start: '12:30', end: '14:00', enabled: true },
  snacks: { start: '17:00', end: '18:00', enabled: true },
  dinner: { start: '19:00', end: '21:00', enabled: true },
};

export type MealStatus = 'COMPLETED' | 'SERVING_NOW' | 'UPCOMING';

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutes(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** Status of one meal at instant `now`. End-exclusive: still Serving Now up to (not including) `end`, Completed from `end` onward. */
export function mealStatusAt(entry: MealTimingEntry, now: Date): MealStatus {
  const minutes = nowMinutes(now);
  const start = hhmmToMinutes(entry.start);
  const end = hhmmToMinutes(entry.end);
  if (minutes < start) return 'UPCOMING';
  if (minutes < end) return 'SERVING_NOW';
  return 'COMPLETED';
}

/** Minutes until `entry.start` — 0 once serving has started (never negative). */
export function minutesUntilStart(entry: MealTimingEntry, now: Date): number {
  return Math.max(0, hhmmToMinutes(entry.start) - nowMinutes(now));
}

/** "Serving Now" / "Starts in 42 min" / "Starts in 1h 5m". */
export function formatCountdown(entry: MealTimingEntry, now: Date): string {
  if (mealStatusAt(entry, now) === 'SERVING_NOW') return 'Serving Now';
  const minutes = minutesUntilStart(entry, now);
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `Starts in ${hours}h` : `Starts in ${hours}h ${rest}m`;
}

/** "7:00 AM – 9:00 AM" — HH:mm 24h -> localized 12h range. */
export function formatTimeRange(entry: MealTimingEntry): string {
  return `${formatClock(entry.start)} – ${formatClock(entry.end)}`;
}

function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * The next relevant meal today: the one currently serving if any (earliest
 * such, in slot order), else the soonest upcoming one, else null once every
 * enabled meal is done — the tenant Next Serving card's core lookup.
 */
export function nextServingAt(
  timings: MealTimings,
  now: Date,
): { slot: MealSlotKey; entry: MealTimingEntry; status: MealStatus } | null {
  const enabled = SLOT_ORDER.filter((slot) => timings[slot]?.enabled);

  const serving = enabled.find((slot) => mealStatusAt(timings[slot], now) === 'SERVING_NOW');
  if (serving) return { slot: serving, entry: timings[serving], status: 'SERVING_NOW' };

  const upcoming = enabled
    .filter((slot) => mealStatusAt(timings[slot], now) === 'UPCOMING')
    .sort((a, b) => hhmmToMinutes(timings[a].start) - hhmmToMinutes(timings[b].start))[0];
  if (upcoming) return { slot: upcoming, entry: timings[upcoming], status: 'UPCOMING' };

  return null;
}

/**
 * TodayCard's adapter (owner Today card): unlike `nextServingAt`, this always
 * resolves to a `current` slot — before the first enabled meal of the day,
 * that first meal is still "current" (the useful answer at 2am is what's
 * coming, not yesterday's dinner). Disabled meals are skipped for both
 * `current` and `next`. Falls back to the first slot in `SLOT_ORDER` only if
 * every meal is disabled, which keeps the return type meal-shaped without a
 * bigger contract change to a component this feature isn't meant to redesign.
 */
export function currentAndNextMeal(timings: MealTimings, now: Date): { current: MealSlotKey; next: MealSlotKey | null } {
  const enabled = SLOT_ORDER.filter((slot) => timings[slot]?.enabled);
  if (enabled.length === 0) {
    return { current: SLOT_ORDER[0], next: SLOT_ORDER[1] ?? null };
  }

  let currentIndex = 0;
  for (let i = 0; i < enabled.length; i++) {
    if (nowMinutes(now) >= hhmmToMinutes(timings[enabled[i]].start)) currentIndex = i;
  }
  return {
    current: enabled[currentIndex],
    next: currentIndex + 1 < enabled.length ? enabled[currentIndex + 1] : null,
  };
}
