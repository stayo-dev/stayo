import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findMany: vi.fn() },
  special_meal_answers: { findMany: vi.fn() },
  roomAllocation: { findMany: vi.fn() },
  stay_leaves: { findMany: vi.fn() },
  hostels: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";
import { decodeMealPayload } from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC = { id: "11111111-1111-4111-8111-111111111111", hostel_id: "h1", owner_id: "own", weekday: 0, meal_type: "LUNCH", veg_dish: "Veg Biryani", non_veg_dish: "Chicken Biryani", cutoff_minutes_before: 180, no_answer_policy: "LAST_CHOICE", is_active: true };
const alloc = (tenantId: string, phone: string | null = "9000000000") => ({
  tenant_id: tenantId, room: { room_no: "101" },
  tenant: { display_name: null, exit_date: null, phone_1: phone, profiles: { name: "Rahul Kumar", phone: null } },
});
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";

let sendTemplate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  sendTemplate = vi.fn().mockResolvedValue({ sent: true, skipped: false });
  db.special_meal_occasions.findMany.mockResolvedValue([OCC]);
  db.hostels.findUnique.mockResolvedValue({ name: "Sri", preferences_config: null });
  db.stay_leaves.findMany.mockResolvedValue([{ tenant_id: T2, start_date: new Date("2026-10-09T00:00:00Z"), expected_return_date: new Date("2026-10-15T00:00:00Z"), returned_at: null }]);
  db.roomAllocation.findMany.mockResolvedValue([alloc(T1), alloc(T2)]);
  db.special_meal_answers.findMany.mockResolvedValue([]);
});

describe("runRound", () => {
  it("ASK on Saturday evening asks tomorrow's residents who are here, with per-tenant payloads", async () => {
    const svc = createSpecialMealService({ sendTemplate: sendTemplate as any });
    const out = await svc.runRound("ASK", new Date("2026-10-10T12:45:00.000Z"));
    expect(db.special_meal_occasions.findMany).toHaveBeenCalledWith({ where: { weekday: 0, is_active: true } });
    expect(sendTemplate).toHaveBeenCalledTimes(1); // T2 is on leave
    const input = sendTemplate.mock.calls[0][0];
    expect(input.templateName).toBe("stayo_special_meal_question");
    expect(input.bodyParameters).toEqual(["Rahul", "Sunday lunch, 11 Oct", "Chicken Biryani or Veg Biryani", "9:30 AM"]);
    expect(input.quickReplyPayloads.map((p: string) => decodeMealPayload(p)?.choice)).toEqual(["VEG", "NON_VEG", "AWAY"]);
    expect(input.quickReplyPayloads.every((p: string) => decodeMealPayload(p)?.tenantId === T1)).toBe(true);
    expect(input.idempotencyKey).toBe(`special_meal_ask:${OCC.id}:2026-10-11:${T1}`);
    expect(out).toMatchObject({ occasions: 1, sent: 1 });
  });

  it("REMIND skips anyone who already answered", async () => {
    db.special_meal_answers.findMany.mockResolvedValue([{ tenant_id: T1, choice: "VEG", source: "WHATSAPP" }]);
    const out = await createSpecialMealService({ sendTemplate: sendTemplate as any }).runRound("REMIND", new Date("2026-10-11T02:45:00.000Z"));
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
  });

  it("sends nothing for a serving whose cutoff has already passed (late cron)", async () => {
    const out = await createSpecialMealService({ sendTemplate: sendTemplate as any }).runRound("REMIND", new Date("2026-10-11T04:30:00.000Z"));
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(out.closed).toBe(1);
  });

  it("keeps going when one send throws", async () => {
    db.roomAllocation.findMany.mockResolvedValue([alloc(T1), alloc("44444444-4444-4444-8444-444444444444")]);
    db.stay_leaves.findMany.mockResolvedValue([]);
    sendTemplate.mockRejectedValueOnce(new Error("132001")).mockResolvedValueOnce({ sent: true, skipped: false });
    const out = await createSpecialMealService({ sendTemplate: sendTemplate as any }).runRound("ASK", new Date("2026-10-10T12:45:00.000Z"));
    expect(out).toMatchObject({ sent: 1, failed: 1 });
  });
});
