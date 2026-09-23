import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted with the vi.mock factories that use them — see
// tests/bulk-import-room-execution.test.ts for the house pattern.
const { findTenant, findConsent, send, isGuardianVerified } = vi.hoisted(() => ({
  findTenant: vi.fn(),
  findConsent: vi.fn(),
  send: vi.fn(),
  isGuardianVerified: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tenants: { findUnique: findTenant },
    stay_guardian_consent: { findUnique: findConsent },
  },
}));

vi.mock("@/lib/services/notifications/whatsapp-template-delivery", () => ({
  whatsAppTemplateDeliveryService: { send },
}));

vi.mock("@/lib/services/notifications/command-center/guardian-access", () => ({
  isGuardianVerified,
}));

vi.mock("@/lib/services/notifications/providers/whatsapp", () => ({
  normalizeWhatsAppPhone: (raw: string) => String(raw || "").replace(/\D/g, "").slice(-10),
}));

import { sendStayGuardianUpdate } from "@/lib/services/notifications/command-center/stay-guardian-updates";

const LEAVE = {
  eventId: "e1",
  tenantId: "t1",
  eventType: "LEAVE_STARTED",
  leaveType: "GOING_HOME",
  expectedReturnDate: "2026-09-27",
  occurredAt: "2026-09-25T09:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  isGuardianVerified.mockResolvedValue(true);
  send.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.1" });
  findTenant.mockResolvedValue({
    id: "t1",
    owner_id: "o1",
    hostel_id: "h1",
    phone_1: "9123456789",
    phone_2: null,
    guardian_name: "Ramesh",
    guardian_phone: "9876543210",
    profiles: { name: "Aarav", phone: "9123456789" },
    hostels: { name: "Sunrise PG" },
  });
  findConsent.mockResolvedValue({
    granted: true,
    guardian_phone: "9876543210",
    revoked_at: null,
    stopped_at: null,
  });
});

describe("sendStayGuardianUpdate", () => {
  it("sends the departure template with the event's own id as the idempotency key", async () => {
    const result = await sendStayGuardianUpdate(LEAVE);
    expect(result).toEqual({ sent: true, reason: "LEAVE" });

    const args = send.mock.calls[0][0];
    expect(args.templateName).toBe("stayo_guardian_stay_departure");
    expect(args.languageCode).toBe("en");
    expect(args.phone).toBe("9876543210");
    // Keying on the EVENT id is what lets the inline send and the daily sweep
    // both attempt without the guardian being messaged twice.
    expect(args.idempotencyKey).toBe("stay_guardian:e1");
    expect(args.bodyParameters).toEqual([
      "Ramesh",
      "Aarav",
      "Sunrise PG",
      "home",
      "Sunday, 27 September",
      // {{6}} — the tenant again, because Meta refuses a repeated variable.
      "Aarav",
    ]);
  });

  it("sends the return template on RETURNED", async () => {
    const result = await sendStayGuardianUpdate({
      ...LEAVE,
      eventId: "e2",
      eventType: "RETURNED",
      leaveType: null,
      expectedReturnDate: null,
      occurredAt: "2026-09-27T14:10:00.000Z",
    });
    expect(result).toEqual({ sent: true, reason: "RETURN" });
    expect(send.mock.calls[0][0].templateName).toBe("stayo_guardian_stay_return");
    expect(send.mock.calls[0][0].bodyParameters).toEqual([
      "Ramesh",
      "Aarav",
      "Sunrise PG",
      "7:40 PM, 27 Sep",
    ]);
  });

  it("sends nothing when consent was never given", async () => {
    findConsent.mockResolvedValue(null);
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({ sent: false, reason: "NO_CONSENT" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when the guardian said STOP", async () => {
    findConsent.mockResolvedValue({
      granted: true,
      guardian_phone: "9876543210",
      revoked_at: null,
      stopped_at: new Date(),
    });
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({
      sent: false,
      reason: "STOPPED_BY_GUARDIAN",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing for an unverified guardian", async () => {
    isGuardianVerified.mockResolvedValue(false);
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({
      sent: false,
      reason: "GUARDIAN_UNVERIFIED",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores an event type outside the family without touching the database at all", async () => {
    expect(await sendStayGuardianUpdate({ ...LEAVE, eventType: "PRESENCE_CONFIRMED" })).toEqual({
      sent: false,
      reason: "NOT_NOTIFIABLE",
    });
    expect(findTenant).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not ask whether the guardian is verified when something cheaper already refused", async () => {
    // isGuardianVerified is a database round trip; NO_CONSENT is free.
    findConsent.mockResolvedValue(null);
    await sendStayGuardianUpdate(LEAVE);
    expect(isGuardianVerified).not.toHaveBeenCalled();
  });

  it("reports a duplicate as ALREADY_SENT rather than a send", async () => {
    send.mockResolvedValue({ sent: false, skipped: true });
    expect(await sendStayGuardianUpdate(LEAVE)).toEqual({ sent: false, reason: "ALREADY_SENT" });
  });

  it("never throws when the provider does — a stay event must not fail for WhatsApp", async () => {
    send.mockRejectedValue(new Error("Meta 500"));
    await expect(sendStayGuardianUpdate(LEAVE)).resolves.toEqual({
      sent: false,
      reason: "SEND_FAILED",
    });
  });

  it("never throws when the tenant lookup itself fails", async () => {
    findTenant.mockRejectedValue(new Error("connection terminated"));
    await expect(sendStayGuardianUpdate(LEAVE)).resolves.toEqual({
      sent: false,
      reason: "SEND_FAILED",
    });
  });
});
