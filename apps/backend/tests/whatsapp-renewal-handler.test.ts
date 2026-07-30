import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, mockDeliverySend, mockEventLog } = vi.hoisted(() => ({
  mockPrisma: {
    renewalOffer: {
      findUnique: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
  mockDeliverySend: vi.fn(),
  mockEventLog: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/services/notifications/whatsapp-template-delivery", () => ({
  whatsAppTemplateDeliveryService: { send: mockDeliverySend },
}));
vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: mockEventLog,
}));

import {
  sendRenewalOfferNotification,
  sendRenewalOfferDeclinedNotification,
  sendRenewalOfferDiscussionNotification,
} from "@/lib/services/notifications/whatsapp-renewal-handler";

describe("WhatsApp Renewal Notification Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseOffer = {
    id: "offer-123",
    tenant_id: "tenant-456",
    hostel_id: "hostel-789",
    owner_id: "owner-999",
    proposed_rent: 8500,
    offer_expires_at: new Date("2026-07-20T00:00:00.000Z"),
    notification_target: "TENANT",
    decline_reason: null,
    tenant: {
      id: "tenant-456",
      phone_1: "+919999988888",
      guardian_name: "Guardian Name",
      guardian_phone: "+919999977777",
      profiles: { name: "Arjun Dev", phone: "+919999988888" },
      room_allocations: [
        {
          is_active: true,
          room: { room_no: "204" },
        },
      ],
    },
    hostel: {
      id: "hostel-789",
      name: "Greenfield Residency",
      phone: "+911111111111",
      profiles: { name: "Owner Name", phone: "+912222222222" },
    },
  };

  it("sends renewal offer notification to tenant only when target is TENANT", async () => {
    mockPrisma.renewalOffer.findUnique.mockResolvedValue({
      ...baseOffer,
      notification_target: "TENANT",
    });
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid-tenant" });

    await sendRenewalOfferNotification("offer-123");

    expect(mockDeliverySend).toHaveBeenCalledTimes(1);
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "919999988888",
        templateName: "renewal_offer_sent_v1",
        bodyParameters: ["Arjun Dev", "Greenfield Residency", "8,500", "20 Jul 2026"],
        idempotencyKey: "renewal_offer_sent_tenant:offer-123",
      })
    );
    expect(mockEventLog.log).toHaveBeenCalledWith(
      "renewal_offer_whatsapp_sent_tenant",
      "owner-999",
      expect.objectContaining({ offer_id: "offer-123" }),
      "tenant-456"
    );
  });

  it("sends renewal offer notification to guardian only when target is GUARDIAN", async () => {
    mockPrisma.renewalOffer.findUnique.mockResolvedValue({
      ...baseOffer,
      notification_target: "GUARDIAN",
    });
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid-guardian" });

    await sendRenewalOfferNotification("offer-123");

    expect(mockDeliverySend).toHaveBeenCalledTimes(1);
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "919999977777",
        templateName: "renewal_offer_sent_v1",
        bodyParameters: ["Guardian Name", "Greenfield Residency", "8,500", "20 Jul 2026"],
        idempotencyKey: "renewal_offer_sent_guardian:offer-123",
      })
    );
    expect(mockEventLog.log).toHaveBeenCalledWith(
      "renewal_offer_whatsapp_sent_guardian",
      "owner-999",
      expect.objectContaining({ offer_id: "offer-123" }),
      "tenant-456"
    );
  });

  it("sends renewal offer notifications to both when target is BOTH", async () => {
    mockPrisma.renewalOffer.findUnique.mockResolvedValue({
      ...baseOffer,
      notification_target: "BOTH",
    });
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid-both" });

    await sendRenewalOfferNotification("offer-123");

    expect(mockDeliverySend).toHaveBeenCalledTimes(2);
    expect(mockDeliverySend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        phone: "919999988888",
        idempotencyKey: "renewal_offer_sent_tenant:offer-123",
      })
    );
    expect(mockDeliverySend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phone: "919999977777",
        idempotencyKey: "renewal_offer_sent_guardian:offer-123",
      })
    );
  });

  it("handles missing guardian phone gracefully when target is BOTH", async () => {
    mockPrisma.renewalOffer.findUnique.mockResolvedValue({
      ...baseOffer,
      notification_target: "BOTH",
      tenant: {
        ...baseOffer.tenant,
        guardian_phone: null,
      },
    });
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false });

    await sendRenewalOfferNotification("offer-123");

    // Should only call send for the tenant since guardian phone is missing
    expect(mockDeliverySend).toHaveBeenCalledTimes(1);
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "919999988888",
      })
    );
    expect(mockEventLog.log).toHaveBeenCalledWith(
      "renewal_offer_whatsapp_failed",
      "owner-999",
      expect.objectContaining({ reason: "no_guardian_phone_number" }),
      "tenant-456"
    );
  });

  it("notifies owner when offer is declined by tenant", async () => {
    mockPrisma.renewalOffer.findUnique.mockResolvedValue({
      ...baseOffer,
      decline_reason: "Taking new job in different city",
    });
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid-decline" });

    await sendRenewalOfferDeclinedNotification("offer-123");

    expect(mockDeliverySend).toHaveBeenCalledTimes(1);
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "912222222222",
        templateName: "renewal_offer_declined_v1",
        bodyParameters: ["Arjun Dev", "204", "Taking new job in different city"],
        idempotencyKey: "renewal_offer_declined:offer-123",
      })
    );
    expect(mockEventLog.log).toHaveBeenCalledWith(
      "renewal_offer_declined_whatsapp_sent",
      "owner-999",
      expect.objectContaining({ offer_id: "offer-123" }),
      "tenant-456"
    );
  });

  it("notifies owner when tenant requests a discussion", async () => {
    mockPrisma.renewalOffer.findUnique.mockResolvedValue(baseOffer);
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid-discuss" });

    await sendRenewalOfferDiscussionNotification("offer-123", "Can we do 12 months with 5% instead?");

    expect(mockDeliverySend).toHaveBeenCalledTimes(1);
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "912222222222",
        templateName: "renewal_offer_discussion_v1",
        bodyParameters: ["Arjun Dev", "204", "Can we do 12 months with 5% instead?"],
        idempotencyKey: "renewal_offer_discussion:offer-123",
      })
    );
    expect(mockEventLog.log).toHaveBeenCalledWith(
      "renewal_offer_discussion_whatsapp_sent",
      "owner-999",
      expect.objectContaining({ offer_id: "offer-123" }),
      "tenant-456"
    );
  });
});
