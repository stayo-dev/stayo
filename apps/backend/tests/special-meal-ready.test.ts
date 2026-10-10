import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findFirst: vi.fn() },
  special_meal_answers: { findMany: vi.fn() },
  special_meal_ready_alerts: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  roomAllocation: { findMany: vi.fn() },
  stay_leaves: { findMany: vi.fn() },
  hostels: { findUnique: vi.fn() },
  whatsapp_logs: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";
import {
  MEAL_READY_TEMPLATES,
  decodeReadyPayload,
  encodeReadyPayload,
} from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC_ID = "11111111-1111-4111-8111-111111111111";
const OCC = { id: OCC_ID, hostel_id: "h1", owner_id: "own", weekday: 0, meal_type: "LUNCH", veg_dish: "Veg Biryani", non_veg_dish: "Chicken Biryani", cutoff_minutes_before: 180, no_answer_policy: "LAST_CHOICE", is_active: true };
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";
const T3 = "44444444-4444-4444-8444-444444444444";
const SUNDAY_NOON = new Date("2026-10-11T06:45:00.000Z"); // 12:15 IST
const alloc = (tenantId: string, name: string) => ({
  tenant_id: tenantId, room: { room_no: "101" },
  tenant: { display_name: null, exit_date: null, phone_1: "9000000000", profiles: { name, phone: null } },
});

let sendTemplate: ReturnType<typeof vi.fn>;
let sendText: ReturnType<typeof vi.fn>;
const svc = () => createSpecialMealService({ sendTemplate: sendTemplate as any, sendText: sendText as any });

beforeEach(() => {
  vi.resetAllMocks();
  db.whatsapp_logs.findMany.mockResolvedValue([]);
  sendTemplate = vi.fn().mockResolvedValue({ sent: true, skipped: false });
  sendText = vi.fn().mockResolvedValue(undefined);
  db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
  db.hostels.findUnique.mockResolvedValue({ name: "Sri Adithya", preferences_config: null });
  db.stay_leaves.findMany.mockResolvedValue([]);
  db.roomAllocation.findMany.mockResolvedValue([alloc(T1, "Rahul K"), alloc(T2, "Arun"), alloc(T3, "Meena")]);
  db.special_meal_answers.findMany
    .mockResolvedValueOnce([
      { tenant_id: T1, choice: "NON_VEG", source: "WHATSAPP" },
      { tenant_id: T2, choice: "AWAY", source: "WHATSAPP" },
      { tenant_id: T3, choice: "VEG", source: "WHATSAPP" },
    ])
    .mockResolvedValueOnce([]);
  db.special_meal_ready_alerts.create.mockResolvedValue({ id: "alert1" });
  db.special_meal_ready_alerts.findMany.mockResolvedValue([]);
});

describe("sendReadyAlert", () => {
  it("pings only the non-veg eaters, with this week's wording, the dish and an On-my-way payload", async () => {
    const out = await svc().sendReadyAlert({ hostelId: "h1", occasionId: OCC_ID, choice: "NON_VEG", sentBy: "own" }, SUNDAY_NOON);
    expect(out.alerts).toEqual([{ choice: "NON_VEG", sent: 1, failed: 0, alreadySent: false }]);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    const input = sendTemplate.mock.calls[0][0];
    expect(MEAL_READY_TEMPLATES.map((t) => t.name)).toContain(input.templateName);
    expect(input.bodyParameters).toEqual(["Rahul", "Chicken Biryani", "Sri Adithya"]);
    expect(decodeReadyPayload(input.quickReplyPayloads[0])).toEqual({ occasionId: OCC_ID, serveDate: "2026-10-11", tenantId: T1 });
    expect(input.idempotencyKey).toBe(`special_meal_ready:${OCC_ID}:2026-10-11:NON_VEG:${T1}`);
    expect(db.special_meal_ready_alerts.update).toHaveBeenCalledWith({ where: { id: "alert1" }, data: { recipients: 1 } });
  });

  it("BOTH sends each choice once", async () => {
    const out = await svc().sendReadyAlert({ hostelId: "h1", occasionId: OCC_ID, choice: "BOTH", sentBy: "own" }, SUNDAY_NOON);
    expect(out.alerts.map((a: any) => a.choice)).toEqual(["NON_VEG", "VEG"]);
    expect(sendTemplate).toHaveBeenCalledTimes(2);
  });

  it("never pings twice for the same choice (the unique key wins a double tap)", async () => {
    db.special_meal_ready_alerts.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(svc().sendReadyAlert({ hostelId: "h1", occasionId: OCC_ID, choice: "NON_VEG", sentBy: "own" }, SUNDAY_NOON))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("refuses on a day the special meal is not served", async () => {
    await expect(svc().sendReadyAlert({ hostelId: "h1", occasionId: OCC_ID, choice: "VEG", sentBy: "own" }, new Date("2026-10-12T06:45:00.000Z")))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(db.special_meal_ready_alerts.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown choice", async () => {
    await expect(svc().sendReadyAlert({ hostelId: "h1", occasionId: OCC_ID, choice: "SKIP" as any, sentBy: "own" }, SUNDAY_NOON))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("falls back to the first wording if this week's template is not approved", async () => {
    const week = MEAL_READY_TEMPLATES.findIndex((t) => t.name !== MEAL_READY_TEMPLATES[0].name);
    // 2026-10-18 rotates away from the first wording; pick whichever date does.
    const dates = ["2026-10-11", "2026-10-18", "2026-10-25"];
    const { readyTemplateFor } = await import("@/lib/services/notifications/providers/whatsapp/special-meal-template-contract");
    const date = dates.find((d) => readyTemplateFor(d).name !== MEAL_READY_TEMPLATES[0].name)!;
    expect(week).toBeGreaterThan(0);
    sendTemplate.mockRejectedValueOnce(Object.assign(new Error("Template name does not exist"), { providerCode: "132001" }));
    const noon = new Date(`${date}T06:45:00.000Z`);
    const out = await svc().sendReadyAlert({ hostelId: "h1", occasionId: OCC_ID, choice: "NON_VEG", sentBy: "own" }, noon);
    expect(out.alerts[0]).toMatchObject({ sent: 1, failed: 0 });
    expect(sendTemplate.mock.calls[1][0].templateName).toBe(MEAL_READY_TEMPLATES[0].name);
    expect(sendTemplate.mock.calls[1][0].idempotencyKey).toMatch(/:fallback$/);
  });
});

describe("On-my-way tap", () => {
  const identity = (own: string[]) => ({ residents: own.map((tenantId) => ({ tenantId, hostelId: "h1", name: "Rahul K" })), guardianResidents: [] }) as any;

  it("answers the resident's own tap warmly", async () => {
    const body = encodeReadyPayload({ occasionId: OCC_ID, serveDate: "2026-10-11", tenantId: T1 });
    const out = await svc().handleWhatsAppReply("91900", body, identity([T1]), SUNDAY_NOON);
    expect(out).toEqual({ handled: true, outcome: "ON_MY_WAY" });
    expect(sendText.mock.calls[0][1]).toContain("Rahul");
  });

  it("ignores a tap naming someone else's tenancy", async () => {
    const body = encodeReadyPayload({ occasionId: OCC_ID, serveDate: "2026-10-11", tenantId: T2 });
    expect(await svc().handleWhatsAppReply("91900", body, identity([T1]), SUNDAY_NOON)).toEqual({ handled: false });
    expect(sendText).not.toHaveBeenCalled();
  });
});
