import { describe, expect, it } from "vitest";
import { canSwap, swapWritesLanded, type SwapCell } from "@/lib/services/food/meal-swap";

/** Pure — no database. Runs under `npm run test:pure`. */
const SCHEDULE = "sched-1";
const cell = (id: string, meal_type: string, schedule_id = SCHEDULE): SwapCell => ({ id, schedule_id, meal_type });

describe("canSwap", () => {
  it("allows two cells of the same meal type in the same schedule", () => {
    expect(canSwap(cell("a", "BREAKFAST"), cell("b", "BREAKFAST"), SCHEDULE)).toEqual({ ok: true, reason: "" });
  });

  it("refuses a missing first cell", () => {
    const v = canSwap(null, cell("b", "BREAKFAST"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/not found/i);
  });

  it("refuses a missing second cell", () => {
    expect(canSwap(cell("a", "BREAKFAST"), null, SCHEDULE).ok).toBe(false);
  });

  it("refuses swapping a cell with itself", () => {
    const v = canSwap(cell("a", "BREAKFAST"), cell("a", "BREAKFAST"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/same cell/i);
  });

  it("refuses different meal types — a breakfast item can never be dinner", () => {
    const v = canSwap(cell("a", "BREAKFAST"), cell("b", "DINNER"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/same meal/i);
  });

  it("refuses a cell belonging to a different schedule", () => {
    const v = canSwap(cell("a", "BREAKFAST"), cell("b", "BREAKFAST", "other-sched"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/schedule/i);
  });

  it("refuses when the first cell belongs to a different schedule", () => {
    expect(canSwap(cell("a", "BREAKFAST", "other"), cell("b", "BREAKFAST"), SCHEDULE).ok).toBe(false);
  });
});

describe("swapWritesLanded", () => {
  it("accepts when both conditional writes matched a row", () => {
    expect(swapWritesLanded(1, 1)).toEqual({ ok: true, reason: "" });
  });

  it("refuses when the first cell was changed by a concurrent swap", () => {
    const v = swapWritesLanded(0, 1);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/changed while/i);
  });

  it("refuses when the second cell was changed by a concurrent swap", () => {
    expect(swapWritesLanded(1, 0).ok).toBe(false);
  });

  it("refuses when neither write matched", () => {
    expect(swapWritesLanded(0, 0).ok).toBe(false);
  });
});
