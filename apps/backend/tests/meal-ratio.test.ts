import { describe, expect, it } from "vitest";
import { forecastMeal, isMealType, mealRatio, median, type ServedLog } from "@/src/services/meals/meal-ratio";

const log = (serveDate: string, servedCount: number, headcountAtLog = 100): ServedLog => ({ serveDate, servedCount, headcountAtLog });
const days = (n: number, servedCount: number) =>
  Array.from({ length: n }, (_, i) => log(`2026-09-${String(i + 1).padStart(2, "0")}`, servedCount));

describe("median", () => {
  it("takes the middle of an odd list and the mean of the middle two of an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
});

describe("mealRatio", () => {
  it("is still learning below three samples, and says so", () => {
    expect(mealRatio([])).toEqual({ ratio: 1, samples: 0, confidence: "learning" });
    expect(mealRatio(days(2, 50))).toMatchObject({ samples: 2, confidence: "learning" });
  });

  it("learns the hostel's own ratio once it has three days", () => {
    expect(mealRatio(days(3, 30))).toEqual({ ratio: 0.3, samples: 3, confidence: "learned" });
  });

  it("shrugs off one festival dinner, which a mean would not", () => {
    const logs = [...days(4, 30), log("2026-09-05", 300)];
    expect(mealRatio(logs).ratio).toBe(0.3);
  });

  it("only looks at the last 14 logged days", () => {
    const old = Array.from({ length: 14 }, (_, i) => log(`2026-08-${String(i + 1).padStart(2, "0")}`, 90));
    const recent = Array.from({ length: 14 }, (_, i) => log(`2026-09-${String(i + 1).padStart(2, "0")}`, 30));
    const r = mealRatio([...old, ...recent]);
    expect(r.samples).toBe(14);
    expect(r.ratio).toBe(0.3);
  });

  it("ignores days nobody lived here, which teach nothing and divide by zero", () => {
    const r = mealRatio([log("2026-09-01", 0, 0), ...days(3, 30)]);
    expect(r.samples).toBe(3);
    expect(Number.isFinite(r.ratio)).toBe(true);
  });

  it("keeps a ratio above 1 — guests and staff eat too", () => {
    expect(mealRatio(days(3, 110)).ratio).toBeCloseTo(1.1, 5);
  });

  it("treats a genuine zero-turnout day as data", () => {
    expect(mealRatio(days(3, 0)).ratio).toBe(0);
  });
});

describe("forecastMeal", () => {
  it("shows the plain headcount while learning", () => {
    expect(forecastMeal(31, mealRatio(days(2, 20)))).toMatchObject({ expected: 31, basis: "headcount", samples: 2 });
  });

  it("applies the learned ratio and rounds to whole people", () => {
    expect(forecastMeal(40, mealRatio(days(3, 30)))).toMatchObject({ expected: 12, basis: "learned" });
    expect(forecastMeal(31, mealRatio(days(3, 85)))).toMatchObject({ expected: 26, basis: "learned" }); // 26.35
  });

  it("never returns a negative or fractional count", () => {
    const r = forecastMeal(0, mealRatio(days(3, 30)));
    expect(r.expected).toBe(0);
    expect(Number.isInteger(r.expected)).toBe(true);
  });
});

describe("isMealType", () => {
  it("knows the four slots", () => {
    expect(isMealType("DINNER")).toBe(true);
    expect(isMealType("BRUNCH")).toBe(false);
  });
});
