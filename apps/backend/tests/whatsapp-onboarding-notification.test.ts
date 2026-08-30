import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildTenantOnboardingTemplatePayload,
  ONBOARDING_COMPLETED_TEMPLATE_NAME,
} from "@/lib/services/notifications/providers/whatsapp/templates";
import { eventLog } from "@/lib/services/event-log-service";

// Mock prisma
const mockPrisma = {
  tenants: { findUnique: vi.fn() },
  whatsapp_logs: {},
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

// Mock eventLog
vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: { log: vi.fn().mockResolvedValue(undefined) },
}));

// Mock WhatsAppTemplateDeliveryService (used by the onboarding handler)
const mockDeliverySend = vi.fn();
vi.mock("@/lib/services/notifications/whatsapp-template-delivery", () => ({
  whatsAppTemplateDeliveryService: { send: mockDeliverySend },
  WhatsAppTemplateDeliveryService: vi.fn(),
}));

describe("buildTenantOnboardingTemplatePayload (pure mapper)", () => {
  it("should return 6 correctly mapped parameters", () => {
    const params = buildTenantOnboardingTemplatePayload({
      tenantName: "Rahul Kumar",
      hostelName: "Sunrise Residency Hostel",
      roomNumber: "G1",
      joiningDate: new Date("2026-06-01"),
      monthlyRent: 8000,
      rentDueDay: 5,
    });

    expect(params).toHaveLength(6);
    expect(params[0]).toBe("Rahul Kumar");
    expect(params[1]).toBe("Sunrise Residency Hostel");
    expect(params[2]).toBe("G1");
    expect(params[3]).toMatch(/\d/); // contains a date
    expect(params[4]).toBe("8,000");
    expect(params[5]).toBe("5");
  });

  it("should use fallback values for missing fields", () => {
    const params = buildTenantOnboardingTemplatePayload({
      tenantName: "",
      hostelName: "",
      roomNumber: "",
      joiningDate: new Date(),
      monthlyRent: 0,
      rentDueDay: 0,
    });

    expect(params[0]).toBe("Resident");
    expect(params[1]).toBe("Your Hostel");
    expect(params[2]).toBe("N/A");
    expect(params[5]).toBe("1"); // clamps to 1
  });

  it("should clamp rent due day to 1-28 range", () => {
    const params1 = buildTenantOnboardingTemplatePayload({
      tenantName: "Test",
      hostelName: "Test",
      roomNumber: "A1",
      joiningDate: new Date(),
      monthlyRent: 5000,
      rentDueDay: 31,
    });
    expect(params1[5]).toBe("28");

    const params2 = buildTenantOnboardingTemplatePayload({
      tenantName: "Test",
      hostelName: "Test",
      roomNumber: "A1",
      joiningDate: new Date(),
      monthlyRent: 5000,
      rentDueDay: -5,
    });
    expect(params2[5]).toBe("1");
  });
});

describe("ONBOARDING_COMPLETED_TEMPLATE_NAME", () => {
  // Was `tenant_onboarding_completed_v1` — a template that does not exist in
  // this WABA, so every post-activation message failed at Meta. The approved
  // one was read from the live Graph API.
  it("points at the approved stayo_tenant_onboarding_complete template", () => {
    expect(ONBOARDING_COMPLETED_TEMPLATE_NAME).toBe("stayo_tenant_onboarding_complete");
  });
});

describe("sendTenantOnboardingNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should skip if tenant not found", async () => {
    mockPrisma.tenants.findUnique.mockResolvedValue(null);

    const { sendTenantOnboardingNotification } = await import(
      "@/lib/services/notifications/whatsapp-onboarding-handler"
    );
    await sendTenantOnboardingNotification("non-existent-id");

    expect(mockDeliverySend).not.toHaveBeenCalled();
  });

  it("should skip if tenant is not ACTIVE", async () => {
    mockPrisma.tenants.findUnique.mockResolvedValue({
      id: "t1",
      status: "INVITED",
      phone_1: "918008046952",
      owner_id: "o1",
      hostel_id: "h1",
      profiles: { name: "Test" },
      hostels: { id: "h1", name: "Hostel", auto_rent_day: 5, owner_id: "o1" },
      room_allocations: [],
    });

    const { sendTenantOnboardingNotification } = await import(
      "@/lib/services/notifications/whatsapp-onboarding-handler"
    );
    await sendTenantOnboardingNotification("t1");

    expect(mockDeliverySend).not.toHaveBeenCalled();
  });

  it("should skip and audit if no phone number", async () => {
    mockPrisma.tenants.findUnique.mockResolvedValue({
      id: "t1",
      status: "ACTIVE",
      phone_1: null,
      owner_id: "o1",
      hostel_id: "h1",
      profiles: { name: "Test", phone: null },
      hostels: { id: "h1", name: "Hostel", auto_rent_day: 5, owner_id: "o1" },
      room_allocations: [],
    });

    const { sendTenantOnboardingNotification } = await import(
      "@/lib/services/notifications/whatsapp-onboarding-handler"
    );
    await sendTenantOnboardingNotification("t1");

    expect(mockDeliverySend).not.toHaveBeenCalled();
    expect(eventLog.log).toHaveBeenCalledWith(
      "tenant_onboarding_whatsapp_failed",
      "o1",
      expect.objectContaining({ reason: "no_phone_number" }),
      "t1"
    );
  });

  it("should send template and audit on success", async () => {
    mockPrisma.tenants.findUnique.mockResolvedValue({
      id: "t1",
      status: "ACTIVE",
      phone_1: "918008046952",
      owner_id: "o1",
      hostel_id: "h1",
      monthly_rent: 8000,
      joined_on: new Date("2026-06-01"),
      profiles: { name: "Rahul Kumar" },
      hostels: { id: "h1", name: "Sunrise Residency Hostel", auto_rent_day: 5, owner_id: "o1" },
      room_allocations: [{ room: { room_no: "G1" } }],
    });

    mockDeliverySend.mockResolvedValue({
      sent: true,
      skipped: false,
      logId: "log-1",
      providerMessageId: "wamid.123",
      idempotencyKey: "tenant_onboarding_completed:t1",
    });

    const { sendTenantOnboardingNotification } = await import(
      "@/lib/services/notifications/whatsapp-onboarding-handler"
    );
    await sendTenantOnboardingNotification("t1");

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: "stayo_tenant_onboarding_complete",
        idempotencyKey: "tenant_onboarding_completed:t1",
        tenantId: "t1",
        hostelId: "h1",
        bodyParameters: expect.arrayContaining(["Rahul Kumar", "Sunrise Residency Hostel", "G1"]),
        languageCode: "en",
      })
    );

    expect(eventLog.log).toHaveBeenCalledWith(
      "tenant_onboarding_whatsapp_sent",
      "o1",
      expect.objectContaining({ tenant_id: "t1", hostel_id: "h1" }),
      "t1"
    );
  });

  it("should audit failure when WhatsApp send fails", async () => {
    mockPrisma.tenants.findUnique.mockResolvedValue({
      id: "t1",
      status: "ACTIVE",
      phone_1: "918008046952",
      owner_id: "o1",
      hostel_id: "h1",
      monthly_rent: 8000,
      joined_on: new Date("2026-06-01"),
      profiles: { name: "Rahul Kumar" },
      hostels: { id: "h1", name: "Sunrise Residency Hostel", auto_rent_day: 5, owner_id: "o1" },
      room_allocations: [{ room: { room_no: "G1" } }],
    });

    mockDeliverySend.mockRejectedValue(new Error("Meta API unavailable"));

    const { sendTenantOnboardingNotification } = await import(
      "@/lib/services/notifications/whatsapp-onboarding-handler"
    );

    // Should NOT throw — Rule 5: WhatsApp failure never breaks onboarding
    await sendTenantOnboardingNotification("t1");

    expect(eventLog.log).toHaveBeenCalledWith(
      "tenant_onboarding_whatsapp_failed",
      "o1",
      expect.objectContaining({ tenant_id: "t1", error: expect.stringContaining("Meta API unavailable") }),
      "t1"
    );
  });

  it("should skip duplicate via idempotency", async () => {
    mockPrisma.tenants.findUnique.mockResolvedValue({
      id: "t1",
      status: "ACTIVE",
      phone_1: "918008046952",
      owner_id: "o1",
      hostel_id: "h1",
      monthly_rent: 8000,
      joined_on: new Date("2026-06-01"),
      profiles: { name: "Rahul Kumar" },
      hostels: { id: "h1", name: "Sunrise Residency Hostel", auto_rent_day: 5, owner_id: "o1" },
      room_allocations: [{ room: { room_no: "G1" } }],
    });

    // Delivery service returns skipped (idempotency key conflict)
    mockDeliverySend.mockResolvedValue({
      sent: false,
      skipped: true,
      idempotencyKey: "tenant_onboarding_completed:t1",
    });

    const { sendTenantOnboardingNotification } = await import(
      "@/lib/services/notifications/whatsapp-onboarding-handler"
    );
    await sendTenantOnboardingNotification("t1");

    // Should NOT audit success since it was skipped
    expect(eventLog.log).not.toHaveBeenCalledWith(
      "tenant_onboarding_whatsapp_sent",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });
});
