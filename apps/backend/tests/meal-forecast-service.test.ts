import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { createMealForecastService } from "@/src/services/meals/meal-forecast-service";

const NOW = new Date("2026-09-14T06:30:00.000Z"); // Monday, noon IST
const BASE = { hostelId: "h1", recordedBy: "p1" };

function makeDb({ residents = 3, leaves = [] as any[], logs = [] as any[] } = {}) {
  const db: any = {
    roomAllocation: {
      findMany: vi.fn(async () => Array.from({ length: residents }, (_, i) => ({ tenant_id: `t${i + 1}` }))),
    },
    stay_leaves: { findMany: vi.fn(async () => leaves) },
    meal_service_logs: {
      findMany: vi.fn(async () => logs),
      upsert: vi.fn(async ({ create }: any) => ({ ...create, id: "log-1" })),
    },
  };
  return db;
}
const leaveRow = (tenant: string, start: string, expected: string, returnedAt: string | null = null) => ({
  tenant_id: tenant,
  start_date: new Date(`${start}T00:00:00.000Z`),
  expected_return_date: new Date(`${expected}T00:00:00.000Z`),
  returned_at: returnedAt ? new Date(returnedAt) : null,
});
const logRow = (date: string, mealType: string, served: number, headcount = 100) => ({
  serve_date: new Date(`${date}T00:00:00.000Z`),
  meal_type: mealType,
  served_count: served,
  headcount_at_log: headcount,
});
const dinnerLogs = (n: number, served: number) =>
  Array.from({ length: n }, (_, i) => logRow(`2026-09-${String(i + 1).padStart(2, "0")}`, "DINNER", served));

describe("getForecast", () => {
  it("answers for today and tomorrow by default", async () => {
    const result = await createMealForecastService({ db: makeDb() }).getForecast("h1", {}, NOW);
    expect(result.today).toBe("2026-09-14");
    expect(result.days.map((d) => d.date)).toEqual(["2026-09-14", "2026-09-15"]);
    expect(result.days[0].meals.map((m) => m.mealType)).toEqual(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]);
  });

  it("shows the headcount, labelled, until a meal has three logged days", async () => {
    const db = makeDb({ logs: dinnerLogs(2, 30) });
    const [today] = (await createMealForecastService({ db }).getForecast("h1", {}, NOW)).days;
    const dinner = today.meals.find((m) => m.mealType === "DINNER")!;
    expect(dinner).toMatchObject({ expected: 3, basis: "headcount", samples: 2, headcount: 3 });
  });

  it("applies a learned ratio once it has three", async () => {
    const db = makeDb({ residents: 40, logs: dinnerLogs(3, 30) });
    const [today] = (await createMealForecastService({ db }).getForecast("h1", {}, NOW)).days;
    expect(today.meals.find((m) => m.mealType === "DINNER")).toMatchObject({ expected: 12, basis: "learned", headcount: 40 });
    // A meal with no logs of its own is untouched by dinner's history.
    expect(today.meals.find((m) => m.mealType === "LUNCH")).toMatchObject({ basis: "headcount", samples: 0 });
  });

  it("subtracts people whose leave covers the day, and counts them again on their return date", async () => {
    const db = makeDb({ residents: 3, leaves: [leaveRow("t2", "2026-09-12", "2026-09-15")] });
    const { days } = await createMealForecastService({ db }).getForecast("h1", { from: "2026-09-14", to: "2026-09-15" }, NOW);
    expect(days[0].meals[0].headcount).toBe(2);
    expect(days[1].meals[0].headcount).toBe(3);
  });

  it("treats an early return as the real end of the leave", async () => {
    const db = makeDb({ residents: 3, leaves: [leaveRow("t2", "2026-09-10", "2026-09-20", "2026-09-13T10:00:00.000Z")] });
    const { days } = await createMealForecastService({ db }).getForecast("h1", { from: "2026-09-14", to: "2026-09-14" }, NOW);
    expect(days[0].meals[0].headcount).toBe(3);
  });

  it("reports what has already been logged, so the kitchen sheet knows what to ask for", async () => {
    const db = makeDb({ logs: [logRow("2026-09-14", "BREAKFAST", 27, 30)] });
    const [today] = (await createMealForecastService({ db }).getForecast("h1", {}, NOW)).days;
    expect(today.meals.find((m) => m.mealType === "BREAKFAST")!.served).toBe(27);
    expect(today.meals.find((m) => m.mealType === "DINNER")!.served).toBeNull();
  });

  it("refuses a nonsense range rather than scanning a year", async () => {
    const service = createMealForecastService({ db: makeDb() });
    await expect(service.getForecast("h1", { from: "nope" }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.getForecast("h1", { from: "2026-09-14", to: "2026-09-01" }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.getForecast("h1", { from: "2026-09-01", to: "2026-10-30" }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("recordServed", () => {
  const served = (over: Record<string, unknown> = {}) => ({ ...BASE, serveDate: "2026-09-14", mealType: "DINNER", servedCount: 27, ...over });

  it("freezes the headcount of the day it is logging", async () => {
    const db = makeDb({ residents: 3, leaves: [leaveRow("t3", "2026-09-13", "2026-09-16")] });
    const entry = await createMealForecastService({ db }).recordServed(served({ servedCount: 2 }) as any, NOW);
    const call = db.meal_service_logs.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      hostel_id_serve_date_meal_type: { hostel_id: "h1", serve_date: new Date("2026-09-14T00:00:00.000Z"), meal_type: "DINNER" },
    });
    expect(call.create).toMatchObject({ served_count: 2, headcount_at_log: 2, recorded_by: "p1" });
    expect(call.update).toMatchObject({ served_count: 2, headcount_at_log: 2 });
    expect(entry).toMatchObject({ mealType: "DINNER", served: 2 });
  });

  it("rejects a future date, since nobody has eaten it yet", async () => {
    await expect(createMealForecastService({ db: makeDb() }).recordServed(served({ serveDate: "2026-09-15" }) as any, NOW))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a count that is obviously a typo", async () => {
    // 3 residents; 200 served is a slipped keypad, not a feast.
    await expect(createMealForecastService({ db: makeDb({ residents: 3 }) }).recordServed(served({ servedCount: 200 }) as any, NOW))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a bad meal, a negative count and a fractional count", async () => {
    const service = createMealForecastService({ db: makeDb() });
    await expect(service.recordServed(served({ mealType: "BRUNCH" }) as any, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.recordServed(served({ servedCount: -1 }) as any, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.recordServed(served({ servedCount: 2.5 }) as any, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("accepts zero — nobody came is a real answer", async () => {
    const db = makeDb();
    await expect(createMealForecastService({ db }).recordServed(served({ servedCount: 0 }) as any, NOW)).resolves.toMatchObject({ served: 0 });
  });
});
