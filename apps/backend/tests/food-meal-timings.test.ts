import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_TIMINGS, normalizeMealTimings, sanitizeMealTimingsPayload } from "@/lib/services/food/meal-timings";

/** Pure — no database. Runs under `npm run test:pure`. */

describe("normalizeMealTimings", () => {
  it("returns the defaults for null/undefined config", () => {
    expect(normalizeMealTimings(null)).toEqual(DEFAULT_MEAL_TIMINGS);
    expect(normalizeMealTimings(undefined)).toEqual(DEFAULT_MEAL_TIMINGS);
  });

  it("returns the defaults when meal_timings is absent", () => {
    expect(normalizeMealTimings({ billing_defaults: {} })).toEqual(DEFAULT_MEAL_TIMINGS);
  });

  it("reads a fully-configured set as-is", () => {
    const configured = {
      BREAKFAST: { start: "07:30", end: "09:30", enabled: true },
      LUNCH: { start: "13:00", end: "14:30", enabled: true },
      SNACKS: { start: "17:00", end: "18:00", enabled: false },
      DINNER: { start: "20:00", end: "21:30", enabled: true },
    };
    expect(normalizeMealTimings({ meal_timings: configured })).toEqual(configured);
  });

  it("falls back per-meal on partial corruption, not the whole set", () => {
    const partiallyBad = {
      BREAKFAST: { start: "07:30", end: "09:30", enabled: true }, // valid
      LUNCH: { start: "14:00", end: "13:00", enabled: true }, // inverted range — invalid
      SNACKS: "not an object", // malformed — invalid
      // DINNER missing entirely
    };
    const result = normalizeMealTimings({ meal_timings: partiallyBad });
    expect(result.BREAKFAST).toEqual({ start: "07:30", end: "09:30", enabled: true });
    expect(result.LUNCH).toEqual(DEFAULT_MEAL_TIMINGS.LUNCH);
    expect(result.SNACKS).toEqual(DEFAULT_MEAL_TIMINGS.SNACKS);
    expect(result.DINNER).toEqual(DEFAULT_MEAL_TIMINGS.DINNER);
  });
});

describe("sanitizeMealTimingsPayload", () => {
  it("accepts a valid partial patch", () => {
    const result = sanitizeMealTimingsPayload({ LUNCH: { start: "12:00", end: "13:30", enabled: true } });
    expect(result).toEqual({ LUNCH: { start: "12:00", end: "13:30", enabled: true } });
  });

  it("accepts a valid full set", () => {
    expect(sanitizeMealTimingsPayload(DEFAULT_MEAL_TIMINGS)).toEqual(DEFAULT_MEAL_TIMINGS);
  });

  it("rejects a non-object payload", () => {
    expect(() => sanitizeMealTimingsPayload(null)).toThrow(/VALIDATION/);
    expect(() => sanitizeMealTimingsPayload("BREAKFAST")).toThrow(/VALIDATION/);
    expect(() => sanitizeMealTimingsPayload([1, 2])).toThrow(/VALIDATION/);
  });

  it("rejects an unknown meal type key", () => {
    expect(() => sanitizeMealTimingsPayload({ BRUNCH: { start: "10:00", end: "11:00", enabled: true } })).toThrow(
      /Unknown meal type/,
    );
  });

  it.each(["9:00", "09:5", "24:00", "09-00", "9:00am", ""])("rejects malformed time %s", (bad) => {
    expect(() => sanitizeMealTimingsPayload({ BREAKFAST: { start: bad, end: "09:00", enabled: true } })).toThrow(
      /HH:mm/,
    );
  });

  it("rejects a non-boolean enabled", () => {
    expect(() =>
      sanitizeMealTimingsPayload({ BREAKFAST: { start: "07:00", end: "09:00", enabled: "yes" } }),
    ).toThrow(/enabled must be a boolean/);
  });

  it("rejects start equal to end", () => {
    expect(() =>
      sanitizeMealTimingsPayload({ BREAKFAST: { start: "08:00", end: "08:00", enabled: true } }),
    ).toThrow(/before end/);
  });

  it("rejects start after end", () => {
    expect(() =>
      sanitizeMealTimingsPayload({ BREAKFAST: { start: "10:00", end: "08:00", enabled: true } }),
    ).toThrow(/before end/);
  });

  it("does not reject overlapping windows across different meal types", () => {
    expect(
      sanitizeMealTimingsPayload({
        LUNCH: { start: "13:00", end: "14:30", enabled: true },
        SNACKS: { start: "14:00", end: "15:00", enabled: true },
      }),
    ).toEqual({
      LUNCH: { start: "13:00", end: "14:30", enabled: true },
      SNACKS: { start: "14:00", end: "15:00", enabled: true },
    });
  });
});
