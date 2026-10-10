import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findFirst: vi.fn(), findMany: vi.fn() },
  special_meal_answers: { findMany: vi.fn() },
  special_meal_ready_alerts: { findMany: vi.fn() },
  whatsapp_logs: { findMany: vi.fn() },
  roomAllocation: { findMany: vi.fn() },
  stay_leaves: { findMany: vi.fn() },
  hostels: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";

const OCC_ID = "11111111-1111-4111-8111-111111111111";
const OCC = { id: OCC_ID, hostel_id: "h1", owner_id: "own", weekday: 1, meal_type: "DINNER", veg_dish: null, non_veg_dish: null, cutoff_minutes_before: 60, no_answer_policy: "LAST_CHOICE", is_active: true };
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";
const T3 = "44444444-4444-4444-8444-444444444444";
const SUNDAY_EVENING = new Date("2026-10-11T12:00:00.000Z"); // Sun 17:30 IST; Monday dinner closes Mon 18:00 IST
const alloc = (tenantId: string) => ({
  tenant_id: tenantId, room: { room_no: "101" },
  tenant: { display_name: null, exit_date: null, phone_1: "9000000000", profiles: { name: "Res", phone: null } },
});
const logKey = (kind: string, tenantId: string) => `special_meal_${kind}:${OCC_ID}:2026-10-12:${tenantId}`;

let sendTemplate: ReturnType<typeof vi.fn>;
const svc = () => createSpecialMealService({ sendTemplate: sendTemplate as any });

beforeEach(() => {
  vi.resetAllMocks();
  sendTemplate = vi.fn().mockResolvedValue({ sent: true, skipped: false });
  db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
  db.hostels.findUnique.mockResolvedValue({ name: "Sri", preferences_config: null }); // dinner 19:00
  db.stay_leaves.findMany.mockResolvedValue([]);
  db.roomAllocation.findMany.mockResolvedValue([alloc(T1), alloc(T2), alloc(T3)]);
  db.special_meal_answers.findMany.mockResolvedValue([]);
  db.special_meal_ready_alerts.findMany.mockResolvedValue([]);
  db.whatsapp_logs.findMany.mockResolvedValue([]);
});

describe("sendNow", () => {
  it("ASK sends the question for the next serving right away, keyed like the cron so neither repeats the other", async () => {
    const out = await svc().sendNow({ hostelId: "h1", occasionId: OCC_ID, kind: "ASK" }, SUNDAY_EVENING);
    expect(out).toMatchObject({ serveDate: "2026-10-12", sent: 3, failed: 0 });
    expect(sendTemplate.mock.calls.map((c) => c[0].idempotencyKey)).toEqual([logKey("ask", T1), logKey("ask", T2), logKey("ask", T3)]);
  });

  it("REMIND goes only to residents who still haven't answered", async () => {
    db.special_meal_answers.findMany.mockResolvedValue([{ tenant_id: T1, choice: "VEG", source: "WHATSAPP" }]);
    const out = await svc().sendNow({ hostelId: "h1", occasionId: OCC_ID, kind: "REMIND" }, SUNDAY_EVENING);
    expect(out.sent).toBe(2);
    expect(sendTemplate.mock.calls.map((c) => c[0].idempotencyKey)).toEqual([logKey("remind", T2), logKey("remind", T3)]);
  });

  it("refuses once answers have closed", async () => {
    await expect(svc().sendNow({ hostelId: "h1", occasionId: OCC_ID, kind: "ASK" }, new Date("2026-10-12T12:31:00.000Z")))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("refuses an unknown kind", async () => {
    await expect(svc().sendNow({ hostelId: "h1", occasionId: OCC_ID, kind: "SPAM" as any }, SUNDAY_EVENING))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("refuses an occasion from another hostel", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(null);
    await expect(svc().sendNow({ hostelId: "h1", occasionId: OCC_ID, kind: "ASK" }, SUNDAY_EVENING))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("buttons and crons never double up", () => {
  it("the 18:00 cron skips residents the owner already asked or reminded by hand", async () => {
    db.special_meal_occasions.findMany.mockResolvedValue([OCC]);
    db.whatsapp_logs.findMany.mockResolvedValue([
      { idempotency_key: logKey("ask", T1), status: "SENT" },
      { idempotency_key: logKey("remind", T2), status: "SENT" },
    ]);
    const out = await svc().runRound("ASK", new Date("2026-10-11T12:45:00.000Z"));
    expect(sendTemplate.mock.calls.map((c) => c[0].idempotencyKey)).toEqual([logKey("ask", T3)]);
    expect(out.sent).toBe(1);
  });
});

describe("getCount outreach", () => {
  it("counts who was asked, reminded and unreachable, and who is still left to ask or remind", async () => {
    db.whatsapp_logs.findMany.mockResolvedValue([
      { idempotency_key: logKey("ask", T1), status: "DELIVERED" },
      { idempotency_key: logKey("ask", T2), status: "SENT" },
      { idempotency_key: logKey("remind", T2), status: "READ" },
      { idempotency_key: logKey("ask", T3), status: "FAILED" },
    ]);
    const out = await svc().getCount("h1", OCC_ID, undefined, SUNDAY_EVENING);
    // T1 (asked, silent) and T3 (ask failed) can still be reminded; a reminder is a second try for T3.
    expect(out.outreach).toEqual({ asked: 2, reminded: 1, unreachable: 1, toAsk: 0, toRemind: 2 });
  });

  it("offers to ask everyone before anything was sent, and nobody who already answered", async () => {
    db.special_meal_answers.findMany.mockResolvedValueOnce([{ tenant_id: T1, choice: "VEG", source: "OWNER" }]).mockResolvedValueOnce([]);
    const out = await svc().getCount("h1", OCC_ID, undefined, SUNDAY_EVENING);
    expect(out.outreach).toEqual({ asked: 0, reminded: 0, unreachable: 0, toAsk: 2, toRemind: 0 });
  });
});
