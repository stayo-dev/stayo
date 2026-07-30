import { describe, expect, it, vi, beforeEach } from "vitest";
import { whatsappReminderDeliveryService } from "@/lib/services/notifications/whatsapp-reminder-delivery";
import { prisma } from "@/lib/db";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp/meta-provider";

vi.mock("@/lib/db", () => {
  return {
    prisma: {
      rent_obligations: {
        findUnique: vi.fn(),
      },
      tenants: {
        findUnique: vi.fn(),
      },
      payment_link_tokens: {
        create: vi.fn(),
      },
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("WhatsAppReminderDeliveryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips sending if the obligation is already settled (PAID/WAIVED/etc)", async () => {
    vi.mocked(prisma.rent_obligations.findUnique).mockResolvedValueOnce({
      status: "PAID",
      is_superseded: false,
    } as any);

    const result = await whatsappReminderDeliveryService.sendRentReminder({
      ownerId: "owner-1",
      tenantId: "tenant-1",
      hostelId: "hostel-1",
      obligationId: "ob-1",
      phone: "7901070333",
      tenantName: "Tenant One",
      hostelName: "Adithya Hostel",
      amount: 5000,
      rentMonth: new Date("2026-06-01"),
      dueDate: new Date("2026-06-05"),
      daysOverdue: 0,
      sendDateKey: "2026-06-05",
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("SETTLED_OR_CANCELLED");
    expect(prisma.rent_obligations.findUnique).toHaveBeenCalledWith({
      where: { id: "ob-1" },
      select: { status: true, is_superseded: true },
    });
    // Should not check tenant or reserve log
    expect(prisma.tenants.findUnique).not.toHaveBeenCalled();
  });

  it("sends rent due today reminder with rent_due_today_v1 template to tenant only", async () => {
    vi.mocked(prisma.rent_obligations.findUnique).mockResolvedValueOnce({
      status: "PENDING",
      is_superseded: false,
    } as any);

    vi.mocked(prisma.tenants.findUnique).mockResolvedValueOnce({
      guardian_phone: "919000000011",
    } as any);

    // Mock reservation success (returns a row)
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id: "log-1", delivery_status: "PENDING" }]);
    
    // Mock token creation
    vi.mocked(prisma.payment_link_tokens.create).mockResolvedValueOnce({ token: "token-123" } as any);

    // Spy on prototype
    const sendTemplateSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTemplate").mockResolvedValueOnce({
      providerMessageId: "wamid.mock_id",
      attempts: 1,
      raw: { success: true },
    });

    const result = await whatsappReminderDeliveryService.sendRentReminder({
      ownerId: "owner-1",
      tenantId: "tenant-1",
      hostelId: "hostel-1",
      obligationId: "ob-1",
      phone: "7901070333",
      tenantName: "Tenant One",
      hostelName: "Adithya Hostel",
      amount: 5000,
      rentMonth: new Date("2026-06-01"),
      dueDate: new Date("2026-06-05"),
      daysOverdue: 0, // Due today
      sendDateKey: "2026-06-05",
    });

    expect(result.sent).toBe(true);
    expect(result.idempotencyKey).toBe("rent_reminder:ob-1:RENT_DUE_TODAY:2026-06-05:tenant");
    
    // Verify template and parameters passed to MetaWhatsAppProvider
    expect(sendTemplateSpy).toHaveBeenCalledTimes(1);
    expect(sendTemplateSpy).toHaveBeenCalledWith({
      to: "917901070333",
      templateName: "rent_due_today_v1",
      language: { code: "en" },
      bodyParameters: ["Tenant One", "5,000", "June 2026"],
      buttonParameters: ["token-123"],
    });

    // Check that update log was called
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("escalates and sends to both tenant and guardian if daysOverdue >= 3", async () => {
    vi.mocked(prisma.rent_obligations.findUnique).mockResolvedValueOnce({
      status: "PENDING",
      is_superseded: false,
    } as any);

    vi.mocked(prisma.tenants.findUnique).mockResolvedValueOnce({
      guardian_phone: "919000000011",
    } as any);

    // Mock reservation for tenant, then for guardian
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: "log-tenant", delivery_status: "PENDING" }])
      .mockResolvedValueOnce([{ id: "log-guardian", delivery_status: "PENDING" }]);
    
    // Mock token creation for tenant, then for guardian
    vi.mocked(prisma.payment_link_tokens.create)
      .mockResolvedValueOnce({ token: "token-tenant" } as any)
      .mockResolvedValueOnce({ token: "token-guardian" } as any);

    // Spy on prototype
    const sendTemplateSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTemplate").mockResolvedValue({
      providerMessageId: "wamid.mock_id",
      attempts: 1,
      raw: { success: true },
    });

    const result = await whatsappReminderDeliveryService.sendRentReminder({
      ownerId: "owner-1",
      tenantId: "tenant-1",
      hostelId: "hostel-1",
      obligationId: "ob-1",
      phone: "7901070333",
      tenantName: "Tenant One",
      hostelName: "Adithya Hostel",
      amount: 5000,
      rentMonth: new Date("2026-06-01"),
      dueDate: new Date("2026-06-05"),
      daysOverdue: 3, // Overdue escalation
      sendDateKey: "2026-06-08",
    });

    expect(result.sent).toBe(true);
    expect(result.idempotencyKey).toBe("rent_reminder:ob-1:RENT_OVERDUE_REMINDER:2026-06-08:tenant");

    // Verify MetaWhatsAppProvider was called twice (once for tenant, once for guardian)
    expect(sendTemplateSpy).toHaveBeenCalledTimes(2);

    // First call (tenant)
    expect(sendTemplateSpy).toHaveBeenNthCalledWith(1, {
      to: "917901070333",
      templateName: "rent_overdue_warm_v1",
      language: { code: "en_IN" },
      bodyParameters: ["Tenant One", "5,000", "June 2026", "05/06/2026", "3"],
      buttonParameters: ["token-tenant"],
    });

    // Second call (guardian)
    expect(sendTemplateSpy).toHaveBeenNthCalledWith(2, {
      to: "919000000011",
      templateName: "rent_overdue_warm_v1",
      language: { code: "en_IN" },
      bodyParameters: ["Tenant One", "5,000", "June 2026", "05/06/2026", "3"],
      buttonParameters: ["token-guardian"],
    });
  });
});
