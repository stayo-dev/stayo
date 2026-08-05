import { describe, expect, it } from "vitest";
import { assignWeekForMealType, type RankedFoodItem } from "@/lib/services/food-schedule-generator";

/** Pure — no database. Runs under `npm run test:pure`. */
const item = (id: string, name: string, votes = 0): RankedFoodItem => ({ id, name, votes });

describe("assignWeekForMealType", () => {
  it("returns 7 days in Monday-first order", () => {
    const week = assignWeekForMealType([item("a", "Dosa")]);
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.day_of_week)).toEqual([
      "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
    ]);
  });

  it("marks every day 'Not set' with a null item when the library is empty", () => {
    const week = assignWeekForMealType([]);
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.menu_item_id === null)).toBe(true);
    expect(week.every((d) => d.item_name === "Not set")).toBe(true);
  });

  it("fills all 7 days with the only item when the library has one", () => {
    const week = assignWeekForMealType([item("a", "Dosa")]);
    expect(week.every((d) => d.item_name === "Dosa")).toBe(true);
  });

  it("splits 7 slots as evenly as possible when nobody voted", () => {
    const week = assignWeekForMealType([item("a", "A"), item("b", "B")]);
    const counts = week.reduce<Record<string, number>>((acc, d) => {
      acc[d.item_name] = (acc[d.item_name] ?? 0) + 1;
      return acc;
    }, {});
    expect(Object.values(counts).sort()).toEqual([3, 4]);
  });

  it("gives every item at least one day in an even split of 7 across 7", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"].map((k) => item(k, k.toUpperCase()));
    const week = assignWeekForMealType(items);
    expect(new Set(week.map((d) => d.item_name)).size).toBe(7);
  });

  it("allocates slots proportionally to votes", () => {
    // 6 vs 1 of 7 total votes -> 6 and 1 slots
    const week = assignWeekForMealType([item("a", "Popular", 60), item("b", "Rare", 10)]);
    const counts = week.reduce<Record<string, number>>((acc, d) => {
      acc[d.item_name] = (acc[d.item_name] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts["Popular"]).toBe(6);
    expect(counts["Rare"]).toBe(1);
  });

  it("always fills exactly 7 slots regardless of vote distribution", () => {
    const cases: RankedFoodItem[][] = [
      [item("a", "A", 1)],
      [item("a", "A", 1), item("b", "B", 1), item("c", "C", 1)],
      [item("a", "A", 100), item("b", "B", 1)],
      [item("a", "A", 3), item("b", "B", 3), item("c", "C", 1)],
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((k, i) => item(k, k, i)),
    ];
    for (const ranked of cases) {
      const week = assignWeekForMealType(ranked);
      expect(week).toHaveLength(7);
      expect(week.every((d) => d.menu_item_id !== null)).toBe(true);
    }
  });

  it("spreads repeats rather than clustering them on consecutive days", () => {
    // A gets 4 slots, B gets 3 — the round-robin deal should alternate.
    const week = assignWeekForMealType([item("a", "A", 4), item("b", "B", 3)]);
    const names = week.map((d) => d.item_name);
    let longestRun = 1;
    let run = 1;
    for (let i = 1; i < names.length; i++) {
      run = names[i] === names[i - 1] ? run + 1 : 1;
      longestRun = Math.max(longestRun, run);
    }
    expect(longestRun).toBeLessThanOrEqual(2);
  });

  it("carries the item id through to the assignment", () => {
    const week = assignWeekForMealType([item("item-1", "Dosa")]);
    expect(week[0].menu_item_id).toBe("item-1");
  });
});
