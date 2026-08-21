import { describe, it, expect } from "vitest";
import { EMPTY_WEEK, mealsServed, scheduleToMessWeek } from "@/src/services/marketing/mess-import";

const meal = (day: string, type: string, name: string | null) => ({
  day_of_week: day,
  meal_type: type,
  item_name: name,
});

describe("scheduleToMessWeek", () => {
  it("places each kitchen row in the listing's own grid", () => {
    const week = scheduleToMessWeek([
      meal("MONDAY", "BREAKFAST", "Idli & sambar"),
      meal("WEDNESDAY", "DINNER", "Chapati, dal"),
      meal("SUNDAY", "LUNCH", "Biryani"),
    ]);
    expect(week[0].b).toBe("Idli & sambar");
    expect(week[2].dn).toBe("Chapati, dal");
    expect(week[6].l).toBe("Biryani");
  });

  it("always returns exactly seven days", () => {
    // Both surfaces index the week positionally — a short week makes a day
    // read as undefined rather than as empty.
    expect(scheduleToMessWeek([]).length).toBe(7);
    expect(scheduleToMessWeek([meal("MONDAY", "LUNCH", "Rice")]).length).toBe(7);
  });

  it("skips rows it cannot place instead of guessing", () => {
    const week = scheduleToMessWeek([
      meal("SOMEDAY", "LUNCH", "Mystery"),
      meal("MONDAY", "BRUNCH", "Mystery"),
    ]);
    expect(week).toEqual(EMPTY_WEEK);
  });

  it("tolerates a scheduled slot with no item", () => {
    expect(scheduleToMessWeek([meal("MONDAY", "LUNCH", null)])[0].l).toBe("");
  });

  it("trims and caps a very long item name to the listing's field length", () => {
    const week = scheduleToMessWeek([meal("MONDAY", "LUNCH", `  ${"x".repeat(300)}  `)]);
    expect(week[0].l.length).toBe(200);
  });
});

describe("mealsServed", () => {
  it("reports only meals the kitchen actually fills", () => {
    expect(mealsServed([meal("MONDAY", "BREAKFAST", "Idli"), meal("MONDAY", "SNACKS", "  ")])).toEqual({
      b: true,
      l: false,
      s: false,
      dn: false,
    });
  });
});
