/**
 * How many people actually eat, learned from what this hostel actually served.
 *
 * A headcount is not a meal count: nearly everyone eats dinner and far fewer
 * eat lunch, so showing occupancy as a meal number overstates lunch every day.
 * The ratio here is measured, never assumed — and while it has too little
 * history to be trusted, the caller is told to show the headcount instead.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts. Keep it that way.
 * See docs/superpowers/specs/2026-09-14-meal-forecast-design.md.
 */

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export function isMealType(value: unknown): value is MealType {
  return typeof value === "string" && (MEAL_TYPES as readonly string[]).includes(value);
}

/** Two weeks of service — long enough for a hostel's rhythm, short enough to follow it. */
export const RATIO_WINDOW_DAYS = 14;
/** Below this it is a rumour, not a ratio. */
export const MIN_RATIO_SAMPLES = 3;

export interface ServedLog {
  serveDate: string;
  servedCount: number;
  headcountAtLog: number;
}

export interface MealRatio {
  ratio: number;
  samples: number;
  confidence: "learning" | "learned";
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median, not mean: one festival dinner or one exam-week lunch should not move
 * what the kitchen cooks for a fortnight. Days when nobody lived here are
 * dropped — they teach nothing and would divide by zero.
 */
export function mealRatio(logs: ServedLog[]): MealRatio {
  const usable = logs
    .filter((l) => l.headcountAtLog > 0)
    .sort((a, b) => b.serveDate.localeCompare(a.serveDate))
    .slice(0, RATIO_WINDOW_DAYS);
  const samples = usable.length;
  if (samples === 0) return { ratio: 1, samples: 0, confidence: "learning" };
  return {
    ratio: median(usable.map((l) => l.servedCount / l.headcountAtLog)),
    samples,
    confidence: samples >= MIN_RATIO_SAMPLES ? "learned" : "learning",
  };
}

export type MealBasis = "learned" | "headcount";

/**
 * The number a kitchen is shown. While learning it is the honest headcount,
 * and the caller labels it as such — a guess dressed as a forecast is worse
 * than no forecast, because it gets believed once and then abandoned.
 */
export function forecastMeal(headcount: number, ratio: MealRatio): { expected: number; basis: MealBasis; samples: number } {
  if (ratio.confidence !== "learned") return { expected: headcount, basis: "headcount", samples: ratio.samples };
  return { expected: Math.max(0, Math.round(headcount * ratio.ratio)), basis: "learned", samples: ratio.samples };
}
