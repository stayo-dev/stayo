import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findMany: vi.fn(), findFirst: vi.fn() },
  special_meal_answers: { upsert: vi.fn() },
  hostels: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";
import { encodeMealPayload } from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC_ID = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";
const OCC = { id: OCC_ID, hostel_id: "h1", weekday: 0, meal_type: "LUNCH", cutoff_minutes_before: 180, is_active: true };
const SAT_EVENING = new Date("2026-10-10T13:00:00.000Z"); // Sat 18:30 IST; Sunday's cutoff is 04:00Z
const identity = (own: string[], guardianOf: string[] = []) =>
  ({
    residents: [...own, ...guardianOf].map((tenantId) => ({ tenantId, hostelId: "h1" })),
    guardianResidents: guardianOf.map((tenantId) => ({ tenantId, hostelId: "h1" })),
  }) as any;

let sendText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  sendText = vi.fn().mockResolvedValue(undefined);
  db.hostels.findUnique.mockResolvedValue({ preferences_config: null });
  db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
  db.special_meal_occasions.findMany.mockResolvedValue([OCC]);
});
const svc = () => createSpecialMealService({ sendText: sendText as any });

describe("handleWhatsAppReply — taps", () => {
  it("records the tapped choice for the payload's own serving", async () => {
    const body = encodeMealPayload({ occasionId: OCC_ID, serveDate: "2026-10-11", tenantId: T1, choice: "AWAY" });
    const out = await svc().handleWhatsAppReply("91900", body, identity([T1]), SAT_EVENING);
    expect(out).toEqual({ handled: true, outcome: "ANSWERED" });
    expect(db.special_meal_answers.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenant_id: T1, choice: "AWAY", source: "WHATSAPP", recorded_by: null }),
    }));
    expect(sendText.mock.calls[0][1]).toContain("won't cook for you");
  });

  it("refuses last week's button once its cutoff has passed, writing nothing", async () => {
    const body = encodeMealPayload({ occasionId: OCC_ID, serveDate: "2026-10-04", tenantId: T1, choice: "VEG" });
    const out = await svc().handleWhatsAppReply("91900", body, identity([T1]), SAT_EVENING);
    expect(out.outcome).toBe("CLOSED");
    expect(db.special_meal_answers.upsert).not.toHaveBeenCalled();
  });

  it("never lets a shared phone answer for someone who is not its own resident", async () => {
    const body = encodeMealPayload({ occasionId: OCC_ID, serveDate: "2026-10-11", tenantId: T2, choice: "VEG" });
    const out = await svc().handleWhatsAppReply("91900", body, identity([T1], [T2]), SAT_EVENING);
    expect(out.handled).toBe(false);
    expect(db.special_meal_answers.upsert).not.toHaveBeenCalled();
  });
});

describe("handleWhatsAppReply — typed", () => {
  it("answers the one open serving", async () => {
    const out = await svc().handleWhatsAppReply("91900", "non veg", identity([T1]), SAT_EVENING);
    expect(out.outcome).toBe("ANSWERED");
    expect(db.special_meal_answers.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ choice: "NON_VEG" }) }));
  });

  it("declines silently for a guardian, so the router falls through", async () => {
    const out = await svc().handleWhatsAppReply("91900", "veg", identity([], [T2]), SAT_EVENING);
    expect(out).toEqual({ handled: false });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("declines when there is no special meal today or tomorrow", async () => {
    db.special_meal_occasions.findMany.mockResolvedValue([]);
    const out = await svc().handleWhatsAppReply("91900", "veg", identity([T1]), SAT_EVENING);
    expect(out).toEqual({ handled: false });
  });

  it("asks a two-resident phone to tap instead of guessing", async () => {
    const out = await svc().handleWhatsAppReply("91900", "veg", identity([T1, T2]), SAT_EVENING);
    expect(out.outcome).toBe("AMBIGUOUS");
    expect(db.special_meal_answers.upsert).not.toHaveBeenCalled();
  });

  it("ignores text that is not an answer", async () => {
    expect(await svc().handleWhatsAppReply("91900", "rent", identity([T1]), SAT_EVENING)).toEqual({ handled: false });
  });
});
