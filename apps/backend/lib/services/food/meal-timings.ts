export type FoodMealTypeKey = "BREAKFAST" | "LUNCH" | "SNACKS" | "DINNER";

export interface MealTimingEntry {
  start: string; // "HH:mm", 24h
  end: string; // "HH:mm", 24h
  enabled: boolean;
}

export type MealTimings = Record<FoodMealTypeKey, MealTimingEntry>;

const MEAL_TYPES: FoodMealTypeKey[] = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Four sensible defaults, not a claim about any real hostel's kitchen hours.
 * Used both as the fallback for a hostel that has never configured its own,
 * and as the starting point the owner's Meal Timings screen edits from.
 */
export const DEFAULT_MEAL_TIMINGS: MealTimings = {
  BREAKFAST: { start: "07:00", end: "09:00", enabled: true },
  LUNCH: { start: "12:30", end: "14:00", enabled: true },
  SNACKS: { start: "17:00", end: "18:00", enabled: true },
  DINNER: { start: "19:00", end: "21:00", enabled: true },
};

function asConfig(raw: unknown): Record<string, any> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
}

function isValidEntry(value: unknown): value is MealTimingEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.start === "string" &&
    HHMM.test(entry.start) &&
    typeof entry.end === "string" &&
    HHMM.test(entry.end) &&
    typeof entry.enabled === "boolean" &&
    entry.start < entry.end
  );
}

/**
 * Reads `preferences_config.meal_timings`; never throws. Each meal type is
 * normalized independently — one malformed or missing key falls back to just
 * that meal's default rather than discarding the whole set, so a partially
 * corrupted config still serves three good meals instead of blanking the day.
 */
export function normalizeMealTimings(rawConfig: unknown): MealTimings {
  const stored = asConfig(asConfig(rawConfig).meal_timings);
  const result = {} as MealTimings;
  for (const mealType of MEAL_TYPES) {
    const candidate = stored[mealType];
    result[mealType] = isValidEntry(candidate) ? candidate : DEFAULT_MEAL_TIMINGS[mealType];
  }
  return result;
}

/**
 * Validates and normalizes an owner-submitted patch (full or partial set).
 * Throws `VALIDATION: <message>` on bad input — same convention as
 * `hostel-billing-preferences-service.ts`'s `sanitize*Payload` helpers, so
 * the route's existing `toApiError`-style handler needs no new branch.
 *
 * Overlap between *different* meal types is deliberately not rejected — a
 * hostel may legitimately run Lunch and Snacks close together. Only a
 * meal's own start/end ordering is enforced, and only same-day windows are
 * supported in v1 (no meal may span midnight).
 */
export function sanitizeMealTimingsPayload(payload: unknown): Partial<MealTimings> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("VALIDATION: meal_timings must be an object");
  }
  const body = payload as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter((key) => !MEAL_TYPES.includes(key as FoodMealTypeKey));
  if (unknownKeys.length > 0) {
    throw new Error(`VALIDATION: Unknown meal type(s): ${unknownKeys.join(", ")}`);
  }

  const next: Partial<MealTimings> = {};
  for (const mealType of MEAL_TYPES) {
    if (!(mealType in body)) continue;
    const entry = body[mealType] as Record<string, unknown>;
    if (!entry || typeof entry !== "object") {
      throw new Error(`VALIDATION: ${mealType} must be an object`);
    }
    const start = String(entry.start ?? "");
    const end = String(entry.end ?? "");
    if (!HHMM.test(start) || !HHMM.test(end)) {
      throw new Error(`VALIDATION: ${mealType} start/end must be HH:mm`);
    }
    if (typeof entry.enabled !== "boolean") {
      throw new Error(`VALIDATION: ${mealType}.enabled must be a boolean`);
    }
    if (start >= end) {
      throw new Error(`VALIDATION: ${mealType} start must be before end`);
    }
    next[mealType] = { start, end, enabled: entry.enabled };
  }
  return next;
}
