import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  special_meal_answers: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  special_meal_ready_alerts: { findMany: vi.fn() },
  roomAllocation: { findMany: vi.fn() },
  stay_leaves: { findMany: vi.fn() },
  hostels: { findUnique: vi.fn() },
  whatsapp_logs: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";

const HOSTEL = "h1";
const OCC = { id: "o1", hostel_id: HOSTEL, owner_id: "own", weekday: 0, meal_type: "LUNCH", veg_dish: null, non_veg_dish: null, cutoff_minutes_before: 180, no_answer_policy: "LAST_CHOICE", is_active: true };
const NOW = new Date("2026-10-10T12:00:00.000Z"); // Saturday 17:30 IST
const alloc = (tenantId: string, room = "101") => ({
  tenant_id: tenantId, room: { room_no: room },
  tenant: { display_name: null, exit_date: null, phone_1: "9000000000", profiles: { name: tenantId.toUpperCase(), phone: null } },
});

beforeEach(() => {
  vi.resetAllMocks();
  db.whatsapp_logs.findMany.mockResolvedValue([]);
  db.hostels.findUnique.mockResolvedValue({ name: "Sri", preferences_config: null }); // default LUNCH 12:30
  db.stay_leaves.findMany.mockResolvedValue([]);
  db.special_meal_ready_alerts.findMany.mockResolvedValue([]);
});

describe("getCount", () => {
  it("defaults to the next serving, composes residents, leaves and answers", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a"), alloc("b"), alloc("c")]);
    db.special_meal_answers.findMany
      .mockResolvedValueOnce([{ tenant_id: "a", choice: "VEG", source: "WHATSAPP" }]) // this serving
      .mockResolvedValueOnce([{ tenant_id: "b", choice: "NON_VEG" }]); // history
    const svc = createSpecialMealService();
    const out = await svc.getCount(HOSTEL, "o1", undefined, NOW);
    expect(out.serveDate).toBe("2026-10-11");
    expect(out.isOpen).toBe(true);
    expect(out.cutoffAt).toBe("2026-10-11T04:00:00.000Z");
    expect(out.count.cook).toEqual({ veg: 1, nonVeg: 1 });
    expect(out.count.noAnswer).toBe(1);
    expect(out.isToday).toBe(false);
    expect(out.readyAlerts).toEqual([]);
    expect(out.mealStart).toBe("12:30");
  });

  it("refuses an occasion from another hostel", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(null);
    await expect(createSpecialMealService().getCount(HOSTEL, "o1", undefined, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a date that is not the occasion's weekday", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    await expect(createSpecialMealService().getCount(HOSTEL, "o1", "2026-10-12", NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("createOccasion", () => {
  it("validates weekday, meal and cutoff", async () => {
    const svc = createSpecialMealService();
    await expect(svc.createOccasion(HOSTEL, "own", { weekday: 7, mealType: "LUNCH" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(svc.createOccasion(HOSTEL, "own", { weekday: 0, mealType: "BRUNCH" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(svc.createOccasion(HOSTEL, "own", { weekday: 0, mealType: "LUNCH", cutoffMinutesBefore: -5 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("turns the unique violation into a 409", async () => {
    db.special_meal_occasions.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(createSpecialMealService().createOccasion(HOSTEL, "own", { weekday: 0, mealType: "LUNCH" }, NOW))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("setOwnerAnswer", () => {
  it("upserts an OWNER answer even after the cutoff", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a")]);
    const late = new Date("2026-10-11T06:00:00.000Z");
    await createSpecialMealService().setOwnerAnswer({ hostelId: HOSTEL, occasionId: "o1", tenantId: "a", serveDate: "2026-10-11", choice: "SKIP", recordedBy: "own" }, late);
    expect(db.special_meal_answers.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { occasion_id_serve_date_tenant_id: { occasion_id: "o1", serve_date: new Date("2026-10-11T00:00:00.000Z"), tenant_id: "a" } },
      create: expect.objectContaining({ choice: "SKIP", source: "OWNER", recorded_by: "own" }),
    }));
  });

  it("clears with null", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a")]);
    await createSpecialMealService().setOwnerAnswer({ hostelId: HOSTEL, occasionId: "o1", tenantId: "a", serveDate: "2026-10-11", choice: null, recordedBy: "own" }, NOW);
    expect(db.special_meal_answers.deleteMany).toHaveBeenCalled();
  });

  it("refuses a tenant who does not live in this hostel", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a")]);
    await expect(createSpecialMealService().setOwnerAnswer({ hostelId: HOSTEL, occasionId: "o1", tenantId: "zz", serveDate: "2026-10-11", choice: "VEG", recordedBy: "own" }, NOW))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateOccasion — day and meal", () => {
  it("can move the meal to another day and meal", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.special_meal_occasions.update.mockResolvedValue({ ...OCC, weekday: 3, meal_type: "DINNER" });
    const out = await createSpecialMealService().updateOccasion(HOSTEL, "o1", { weekday: 3, mealType: "DINNER" }, NOW);
    expect(db.special_meal_occasions.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ weekday: 3, meal_type: "DINNER" }) }));
    expect(out).toMatchObject({ weekday: 3, mealType: "DINNER" });
  });

  it("rejects a bad day or meal", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    await expect(createSpecialMealService().updateOccasion(HOSTEL, "o1", { weekday: 9 }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(createSpecialMealService().updateOccasion(HOSTEL, "o1", { mealType: "BRUNCH" }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("turns a clash with another special meal into a 409", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.special_meal_occasions.update.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(createSpecialMealService().updateOccasion(HOSTEL, "o1", { weekday: 3 }, NOW)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("deleteOccasion", () => {
  it("deletes this hostel's special meal", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    await createSpecialMealService().deleteOccasion(HOSTEL, "o1");
    expect(db.special_meal_occasions.delete).toHaveBeenCalledWith({ where: { id: "o1" } });
  });

  it("refuses one from another hostel", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(null);
    await expect(createSpecialMealService().deleteOccasion(HOSTEL, "o1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.special_meal_occasions.delete).not.toHaveBeenCalled();
  });
});

describe("several specials at the same meal", () => {
  it("allows a second Sunday lunch when it names its dishes", async () => {
    db.special_meal_occasions.findMany.mockResolvedValue([{ ...OCC, id: "o1" }]);
    db.special_meal_occasions.create.mockResolvedValue({ ...OCC, id: "o2", non_veg_dish: "Mutton curry", veg_dish: "Paneer" });
    const out = await createSpecialMealService().createOccasion(HOSTEL, "own", { weekday: 0, mealType: "LUNCH", nonVegDish: "Mutton curry", vegDish: "Paneer" }, NOW);
    expect(out.id).toBe("o2");
  });

  it("refuses a second Sunday lunch with no dishes, since residents couldn't tell them apart", async () => {
    db.special_meal_occasions.findMany.mockResolvedValue([{ ...OCC, id: "o1" }]);
    await expect(createSpecialMealService().createOccasion(HOSTEL, "own", { weekday: 0, mealType: "LUNCH" }, NOW))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(db.special_meal_occasions.create).not.toHaveBeenCalled();
  });

  it("applies the same rule when an edit moves a meal next to another one", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue({ ...OCC, id: "o2", weekday: 3, non_veg_dish: null, veg_dish: null });
    db.special_meal_occasions.findMany.mockResolvedValue([{ ...OCC, id: "o1" }, { ...OCC, id: "o2", weekday: 3 }]);
    await expect(createSpecialMealService().updateOccasion(HOSTEL, "o2", { weekday: 0 }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(db.special_meal_occasions.update).not.toHaveBeenCalled();
  });

  it("lets an edit keep its own slot without tripping over itself", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.special_meal_occasions.findMany.mockResolvedValue([OCC]);
    db.special_meal_occasions.update.mockResolvedValue({ ...OCC, cutoff_minutes_before: 60 });
    await expect(createSpecialMealService().updateOccasion(HOSTEL, "o1", { cutoffMinutesBefore: 60 }, NOW)).resolves.toMatchObject({ cutoffMinutesBefore: 60 });
  });
});
