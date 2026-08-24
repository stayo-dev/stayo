import { describe, it, expect } from "vitest";
import {
  MIN_RISE_PCT,
  MIN_RISE_RUPEES,
  detectSpendAnomaly,
  type CategorySpend,
} from "@/lib/services/expenses/expense-anomaly";

const row = (category: string, current: number, previous: number): CategorySpend => ({
  category,
  current,
  previous,
});

describe("detectSpendAnomaly — when to say nothing", () => {
  it("says nothing about an ordinary month", () => {
    expect(detectSpendAnomaly([row("Electricity", 5200, 5000), row("Water", 900, 1000)])).toBeNull();
  });

  it("says nothing when there is nothing to look at", () => {
    expect(detectSpendAnomaly([])).toBeNull();
    expect(detectSpendAnomaly(null as any)).toBeNull();
  });

  it("says nothing about spending that went down", () => {
    expect(detectSpendAnomaly([row("Electricity", 2000, 9000)])).toBeNull();
  });

  // "Up ∞%" is not a sentence anyone should read, and a category with no
  // history is a new supplier or a one-off, not an anomaly.
  it("says nothing when there is no baseline to compare against", () => {
    expect(detectSpendAnomaly([row("Repairs", 40000, 0)])).toBeNull();
  });

  // The floor this rule exists for. The Money screen's rule has none, so
  // ₹100 -> ₹200 is +100% and gets flagged there.
  it("ignores a large percentage on a small amount", () => {
    const anomaly = detectSpendAnomaly([row("Stationery", 200, 100)]);
    expect(anomaly).toBeNull();
  });

  it("ignores a large amount that rose only slightly", () => {
    // +₹3,000 is well over the rupee floor, but +6% on ₹50,000 is ordinary.
    expect(detectSpendAnomaly([row("Groceries", 53000, 50000)])).toBeNull();
  });

  it("requires both floors, not either", () => {
    const justUnderRupees = detectSpendAnomaly([row("A", 100 + MIN_RISE_RUPEES - 1, 100)]);
    expect(justUnderRupees).toBeNull();

    const justUnderPct = detectSpendAnomaly([
      row("B", 100000 + Math.floor((100000 * (MIN_RISE_PCT - 1)) / 100), 100000),
    ]);
    expect(justUnderPct).toBeNull();
  });

  it("survives junk numbers without throwing", () => {
    expect(detectSpendAnomaly([row("A", NaN, 1000), row("B", 5000, Infinity)])).toBeNull();
    expect(detectSpendAnomaly([{ category: "C" } as any])).toBeNull();
  });
});

describe("detectSpendAnomaly — what it picks", () => {
  it("flags a real spike", () => {
    const anomaly = detectSpendAnomaly([row("Electricity", 8000, 5000)]);
    expect(anomaly).toMatchObject({ category: "Electricity", riseAmount: 3000, changePct: 60 });
  });

  it("clears both floors exactly", () => {
    const current = 1000 + MIN_RISE_RUPEES;
    const anomaly = detectSpendAnomaly([row("Water", current, 1000)]);
    expect(anomaly).not.toBeNull();
    expect(anomaly!.riseAmount).toBe(MIN_RISE_RUPEES);
    expect(anomaly!.changePct).toBeGreaterThanOrEqual(MIN_RISE_PCT);
  });

  // Ranked by money that actually left the account, not by percentage.
  it("picks the biggest rise in rupees, not the biggest percentage", () => {
    const anomaly = detectSpendAnomaly([
      row("Stationery", 6000, 1500), // +₹4,500, +300%
      row("Groceries", 62000, 40000), // +₹22,000, +55%
    ]);
    expect(anomaly!.category).toBe("Groceries");
  });

  it("returns one category, never a list", () => {
    const anomaly = detectSpendAnomaly([
      row("Electricity", 9000, 5000),
      row("Water", 8000, 4000),
      row("Repairs", 7000, 3000),
    ]);
    expect(anomaly).not.toBeNull();
    expect(Array.isArray(anomaly)).toBe(false);
  });

  // Otherwise the home page shows a different category on each load.
  it("is stable when two categories rose by the same amount", () => {
    const rows = [row("Zebra", 6000, 3000), row("Alpha", 6000, 3000)];
    expect(detectSpendAnomaly(rows)!.category).toBe("Alpha");
    expect(detectSpendAnomaly([...rows].reverse())!.category).toBe("Alpha");
  });

  it("carries the numbers so the caller can write its own sentence", () => {
    const anomaly = detectSpendAnomaly([row("Electricity", 8000, 5000)])!;
    expect(anomaly.current).toBe(8000);
    expect(anomaly.previous).toBe(5000);
  });

  it("rounds the percentage rather than showing a fraction", () => {
    const anomaly = detectSpendAnomaly([row("Electricity", 7333, 5000)])!;
    expect(Number.isInteger(anomaly.changePct)).toBe(true);
  });
});
