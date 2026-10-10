/**
 * The food menu persists across months (2026-10-10).
 *
 * `food_schedules` is one row per (hostel, month), and a new month's row used
 * to be created empty — so on the 1st the owner's Meal Plan, Home card and
 * Kitchen Sheet were blank and the week had to be rebuilt. These run the real
 * `ensureMonthSchedule` against an in-memory database; only `@/lib/db` is fake.
 */
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const db = vi.hoisted(() => ({ schedules: [] as Row[], meals: [] as Row[], items: [] as Row[], seq: 0 }));

vi.mock("@/lib/db", () => {
  const id = () => `id-${++db.seq}`;
  const withMeals = (s: Row | undefined) =>
    s && {
      ...s,
      food_schedule_meals: db.meals
        .filter((m) => m.schedule_id === s.id)
        .map((m) => ({
          ...m,
          food_schedule_meal_items: db.items
            .filter((i) => i.schedule_meal_id === m.id)
            .sort((a, b) => a.display_order - b.display_order),
        })),
    };
  const sameMonth = (a: Date, b: Date) => a.getTime() === b.getTime();
  const client: any = {
    food_schedules: {
      findUnique: async ({ where, include }: any) => {
        const s = where.id
          ? db.schedules.find((r) => r.id === where.id)
          : db.schedules.find(
              (r) => r.hostel_id === where.hostel_id_month.hostel_id && sameMonth(r.month, where.hostel_id_month.month),
            );
        if (!s) return null;
        return include ? withMeals(s) : { id: s.id };
      },
      findMany: async ({ where, take }: any) =>
        db.schedules
          .filter(
            (r) =>
              r.hostel_id === where.hostel_id &&
              r.month.getTime() < where.month.lt.getTime() &&
              r.source !== where.source.not,
          )
          .sort((a, b) => b.month.getTime() - a.month.getTime())
          .slice(0, take)
          .map(withMeals),
      create: async ({ data }: any) => {
        if (db.schedules.some((r) => r.hostel_id === data.hostel_id && sameMonth(r.month, data.month))) {
          throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        }
        const row = { id: id(), ...data };
        db.schedules.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(db.schedules.find((r) => r.id === where.id)!, data),
    },
    food_schedule_meals: {
      createMany: async ({ data }: any) => {
        for (const d of data) db.meals.push({ id: id(), ...d });
      },
      findMany: async ({ where }: any) => db.meals.filter((m) => m.schedule_id === where.schedule_id),
      update: async ({ where, data }: any) => Object.assign(db.meals.find((m) => m.id === where.id)!, data),
    },
    food_schedule_meal_items: {
      deleteMany: async ({ where }: any) => {
        db.items = db.items.filter((i) => !where.schedule_meal_id.in.includes(i.schedule_meal_id));
      },
      createMany: async ({ data }: any) => {
        for (const d of data) db.items.push({ id: id(), ...d });
      },
    },
  };
  client.$transaction = async (fn: any) => fn(client);
  return { prisma: client };
});

import {
  decideMonth,
  ensureMonthSchedule,
  weekSignature,
  type ScheduleSnapshot,
} from "../lib/services/food/month-carry-forward";

const HOSTEL = "hostel-1";
const OWNER = "owner-1";
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];
const m = (ym: string) => new Date(`${ym}-01T00:00:00.000Z`);
const OCT_10 = new Date("2026-10-10T09:00:00.000Z");

/** The owner builds a full week in `ym` — what the Meal Plan + Publish do. */
function ownerBuildsWeek(ym: string, dish: (day: string, meal: string) => string[], status = "PUBLISHED") {
  const schedule = { id: `s-${ym}`, hostel_id: HOSTEL, owner_id: OWNER, month: m(ym), status, source: "MANUAL", published_at: new Date() };
  db.schedules.push(schedule);
  for (const day of DAYS) {
    for (const meal of MEALS) {
      const cell = { id: `c-${ym}-${day}-${meal}`, schedule_id: schedule.id, day_of_week: day, meal_type: meal, menu_item_id: null, item_name: "Not set" };
      db.meals.push(cell);
      dish(day, meal).forEach((name, i) =>
        db.items.push({ id: `i-${cell.id}-${i}`, schedule_meal_id: cell.id, menu_item_id: `item-${name}`, item_name: name, display_order: i }),
      );
    }
  }
  return schedule;
}

/**
 * The owner edits one cell — mirrors `PATCH .../meals/[mealId]`, which
 * replaces the cell's ordered items and sets the schedule's `source: MANUAL`
 * (asserted against the real route below).
 */
function ownerEditsCell(scheduleId: string, day: string, meal: string, names: string[]) {
  const cell = db.meals.find((c) => c.schedule_id === scheduleId && c.day_of_week === day && c.meal_type === meal)!;
  db.items = db.items.filter((i) => i.schedule_meal_id !== cell.id);
  names.forEach((name, i) =>
    db.items.push({ id: `e-${cell.id}-${i}-${name}`, schedule_meal_id: cell.id, menu_item_id: `item-${name}`, item_name: name, display_order: i }),
  );
  db.schedules.find((s) => s.id === scheduleId)!.source = "MANUAL";
}

const dishesOf = (row: any, day: string, meal: string) =>
  row.food_schedule_meals
    .find((c: any) => c.day_of_week === day && c.meal_type === meal)
    .food_schedule_meal_items.map((i: any) => i.item_name);

const septemberMenu = (day: string, meal: string) =>
  meal === "BREAKFAST" ? ["Idli", "Chutney"] : meal === "LUNCH" ? ["Rice", "Dal"] : meal === "SNACKS" ? ["Tea"] : [`${day} Dinner`];

beforeEach(() => {
  db.schedules = [];
  db.meals = [];
  db.items = [];
  db.seq = 0;
});

describe("a menu saved in one month is there the next month", () => {
  it("September's published menu is October's menu — same dishes, same order, live for tenants", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    const october = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: false, now: OCT_10 });

    expect(october).not.toBeNull();
    expect(october!.status).toBe("PUBLISHED");
    expect(october!.source).toBe("CARRIED_FORWARD");
    expect(october!.food_schedule_meals).toHaveLength(28);
    for (const day of DAYS) for (const meal of MEALS) expect(dishesOf(october, day, meal)).toEqual(septemberMenu(day, meal));
    // The September row is untouched.
    expect(db.schedules.find((s) => s.id === "s-2026-09")!.source).toBe("MANUAL");
  });

  it("keeps going month after month with no owner action", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    const december = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-12"), allowCreateEmpty: false, now: new Date("2026-12-02T00:00:00Z") });
    expect(dishesOf(december, "FRIDAY", "DINNER")).toEqual(["FRIDAY Dinner"]);
    expect(december!.status).toBe("PUBLISHED");
  });

  it("is idempotent — asking again writes nothing", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    const first = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    const itemIdsBefore = db.items.map((i) => i.id).sort();
    const second = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    expect(second!.id).toBe(first!.id);
    expect(db.items.map((i) => i.id).sort()).toEqual(itemIdsBefore);
    expect(db.schedules.filter((s) => s.month.getTime() === m("2026-10").getTime())).toHaveLength(1);
  });

  it("an empty draft the Meal Plan created before this fix is filled, not left blank", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    ownerBuildsWeek("2026-10", () => [], "DRAFT"); // navigated to, never filled
    db.schedules.find((s) => s.id === "s-2026-10")!.source = "MANUAL";
    const october = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    expect(october!.id).toBe("s-2026-10");
    expect(dishesOf(october, "MONDAY", "LUNCH")).toEqual(["Rice", "Dal"]);
    expect(october!.status).toBe("PUBLISHED");
  });
});

describe("owner edits persist into later months", () => {
  it("an edit made in October is what November shows", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    const october = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    ownerEditsCell(october!.id, "MONDAY", "LUNCH", ["Biryani", "Raita"]);

    const november = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-11"), allowCreateEmpty: false, now: new Date("2026-11-01T01:00:00Z") });
    expect(dishesOf(november, "MONDAY", "LUNCH")).toEqual(["Biryani", "Raita"]);
    expect(dishesOf(november, "TUESDAY", "LUNCH")).toEqual(["Rice", "Dal"]);
  });

  it("an owner-edited month is never overwritten by carry-forward", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    const october = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    ownerEditsCell(october!.id, "MONDAY", "LUNCH", ["Biryani"]);
    ownerEditsCell("s-2026-09", "MONDAY", "LUNCH", ["Pulao"]); // later change to an earlier month

    const again = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    expect(dishesOf(again, "MONDAY", "LUNCH")).toEqual(["Biryani"]);
  });

  it("a month that was only copied follows later edits to its source", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    ownerEditsCell("s-2026-09", "SUNDAY", "DINNER", ["Paneer", "Roti"]);

    const october = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: false, now: OCT_10 });
    expect(dishesOf(october, "SUNDAY", "DINNER")).toEqual(["Paneer", "Roti"]);
    expect(october!.source).toBe("CARRIED_FORWARD");
  });
});

describe("safety", () => {
  it("a future month is copied as a draft — tenants never see next month early", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    const november = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-11"), allowCreateEmpty: true, now: OCT_10 });
    expect(november!.status).toBe("DRAFT");
    expect(dishesOf(november, "MONDAY", "BREAKFAST")).toEqual(["Idli", "Chutney"]);

    // ...and goes live by itself once November arrives.
    const inNovember = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-11"), allowCreateEmpty: false, now: new Date("2026-11-01T02:00:00Z") });
    expect(inNovember!.status).toBe("PUBLISHED");
  });

  it("a draft-only menu is carried as a draft, never published on the owner's behalf", async () => {
    ownerBuildsWeek("2026-09", septemberMenu, "DRAFT");
    const october = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    expect(october!.status).toBe("DRAFT");
  });

  it("with no earlier menu, the Meal Plan still gets an empty scaffold and read paths create nothing", async () => {
    expect(await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: false, now: OCT_10 })).toBeNull();
    expect(db.schedules).toHaveLength(0);

    const scaffold = await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: true, now: OCT_10 });
    expect(scaffold!.status).toBe("DRAFT");
    expect(scaffold!.source).toBe("MANUAL");
    expect(scaffold!.food_schedule_meals).toHaveLength(28);
    expect(scaffold!.food_schedule_meals.every((c: any) => c.food_schedule_meal_items.length === 0 && c.item_name === "Not set")).toBe(true);
  });

  it("only looks backwards — a later month's menu is never pulled into an earlier one", async () => {
    ownerBuildsWeek("2026-12", septemberMenu);
    expect(await ensureMonthSchedule({ hostelId: HOSTEL, ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: false, now: OCT_10 })).toBeNull();
  });

  it("never carries one hostel's menu into another", async () => {
    ownerBuildsWeek("2026-09", septemberMenu);
    expect(await ensureMonthSchedule({ hostelId: "hostel-2", ownerId: OWNER, month: m("2026-10"), allowCreateEmpty: false, now: OCT_10 })).toBeNull();
  });
});

describe("decideMonth (pure)", () => {
  const snap = (over: Partial<ScheduleSnapshot>): ScheduleSnapshot => ({
    id: "x",
    month: m("2026-09"),
    status: "PUBLISHED",
    source: "MANUAL",
    cells: [{ day_of_week: "MONDAY", meal_type: "LUNCH", items: [{ menu_item_id: "a", item_name: "A" }] }],
    ...over,
  });
  const base = { target: m("2026-10"), currentMonth: m("2026-10"), allowCreateEmpty: true };

  it("never un-publishes a published copy, even when its source is a draft", () => {
    const decision = decideMonth({ ...base, existing: snap({ source: "CARRIED_FORWARD", status: "PUBLISHED", cells: [] }), source: snap({ status: "DRAFT" }) });
    expect(decision).toEqual({ action: "copy", into: "existing", status: "PUBLISHED" });
  });

  it("signature is order-sensitive — reordering dishes is an edit", () => {
    const a = snap({ cells: [{ day_of_week: "MONDAY", meal_type: "LUNCH", items: [{ menu_item_id: "a", item_name: "A" }, { menu_item_id: "b", item_name: "B" }] }] });
    const b = snap({ cells: [{ day_of_week: "MONDAY", meal_type: "LUNCH", items: [{ menu_item_id: "b", item_name: "B" }, { menu_item_id: "a", item_name: "A" }] }] });
    expect(weekSignature(a)).not.toBe(weekSignature(b));
  });
});

describe("wiring", () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

  it("an owner edit marks the month as the owner's own menu (what makes it flow forward)", () => {
    expect(read("app/api/food/schedules/[id]/meals/[mealId]/route.ts")).toMatch(/data: \{ source: "MANUAL", updated_at: now \}/);
  });

  it("every month reader carries the menu forward; only the Meal Plan may create an empty scaffold", () => {
    const route = read("app/api/food/schedules/route.ts");
    expect(route.match(/ensureMonthSchedule\(/g)).toHaveLength(2);
    expect(route).toMatch(/allowCreateEmpty: false/);
    expect(route).toMatch(/allowCreateEmpty: true/);
    expect(read("app/api/food/tenant/schedule/history/route.ts")).toMatch(/ensureMonthSchedule\(\{[\s\S]*allowCreateEmpty: false/);
    expect(read("app/api/food/menu-pdf/route.ts")).toMatch(/ensureMonthSchedule\(\{[\s\S]*allowCreateEmpty: false/);
  });
});
