import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, mockDeliverySend } = vi.hoisted(() => ({
  mockPrisma: {
    agreement: { findMany: vi.fn(), updateMany: vi.fn() },
    whatsapp_logs: {},
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
  mockDeliverySend: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/services/notifications/whatsapp-template-delivery", () => ({
  whatsAppTemplateDeliveryService: { send: mockDeliverySend },
  WhatsAppTemplateDeliveryService: vi.fn(),
}));

// Mock eventLog
vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: { log: vi.fn().mockResolvedValue(undefined) },
}));

import {
  AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME,
  AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
  OWNER_RENEWAL_ALERT_TEMPLATE_NAME,
  buildAgreementRenewalReminderPayload,
  buildAgreementRenewalOverduePayload,
  buildOwnerRenewalAlertPayload,
} from "@/lib/services/notifications/providers/whatsapp/templates";
import { eventLog } from "@/lib/services/event-log-service";
import { agreementRenewalNotificationService } from "@/src/services/tenants/agreement-renewal-notification-service";

describe("Agreement Renewal Payload Builders", () => {
  it("builds agreement_renewal_reminder_v1 payload correctly", () => {
    const params = buildAgreementRenewalReminderPayload({
      tenantName: "Arjun Dev",
      expiryDate: new Date("2026-07-15T00:00:00.000Z"),
      status: "Expiring in 30 days",
    });
    expect(params).toEqual(["Arjun Dev", "15 Jul 2026", "Expiring in 30 days"]);
  });

  it("builds agreement_renewal_overdue_v1 payload correctly", () => {
    const params = buildAgreementRenewalOverduePayload({
      tenantName: "Arjun Dev",
      expiredOn: new Date("2026-06-15T00:00:00.000Z"),
      status: "Overdue by 7 days",
    });
    expect(params).toEqual(["Arjun Dev", "15 Jun 2026", "Overdue by 7 days"]);
  });

  it("builds owner_renewal_alert_v1 payload correctly", () => {
    const params = buildOwnerRenewalAlertPayload({
      tenantName: "Arjun Dev",
      roomNo: "204",
      status: "Rent Overdue",
      expiryDate: new Date("2026-06-15T00:00:00.000Z"),
      tenantPhone: "+919999988888",
    });
    expect(params).toEqual(["Arjun Dev", "204", "Rent Overdue", "15 Jun 2026", "+919999988888"]);
  });
});

describe("AgreementRenewalNotificationService integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseAgreement = {
    id: "agreement-123",
    tenant_id: "tenant-456",
    hostel_id: "hostel-789",
    status: "SIGNED",
    agreement_version: 1,
    agreement_end_date: new Date("2026-07-14T00:00:00.000Z"),
    contract_rent: 8000,
    contract_security_deposit: 10000,
    contract_maintenance: 1200,
    contract_maintenance_type: "ONE_TIME",
    contract_payment_frequency: "MONTHLY",
    renewed_to_agreement_id: null,
    renewed_to_agreement: null,
    renewed_agreements: [],
    hostel: {
      id: "hostel-789",
      owner_id: "owner-999",
      phone: "+911111111111",
      preferences_config: { renewal_grace_period_days: 30 },
      profiles: { name: "Owner Name", phone: "+912222222222" },
    },
    tenant: {
      id: "tenant-456",
      status: "ACTIVE",
      profile_id: "profile-456",
      phone_1: "+919999988888",
      profiles: { name: "Arjun Dev", phone: "+919999988888" },
      room_allocations: [{ is_active: true, end_date: null, room: { id: "room-1", room_no: "204" } }],
      move_out_requests: [],
      rent_obligations: [],
    },
  };

  it("does not send any expiry reminder once a successor agreement already exists", async () => {
    const now = new Date("2026-06-29T00:00:00.000Z"); // would be exactly 15 days remaining
    const agreementWithSuccessor = {
      ...baseAgreement,
      renewed_to_agreement_id: "successor-1",
      renewed_to_agreement: { id: "successor-1", status: "DRAFT" },
    };

    const result = await agreementRenewalNotificationService.processRenewalNotifications(agreementWithSuccessor, now);

    expect(result.skipped).toBe(true);
    expect(result.tenantSent).toBe(false);
    expect(result.ownerSent).toBe(false);
    expect(mockDeliverySend).not.toHaveBeenCalled();
  });

  it("sends 30-day reminder when exactly 30 days remain", async () => {
    const now = new Date("2026-06-14T00:00:00.000Z"); // 30 days before July 14
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.1" });

    const result = await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(true);
    expect(result.ownerSent).toBe(true);

    // Tenant message verification
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919999988888",
        templateName: AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME,
        idempotencyKey: "agreement_renewal_30_day_reminder:agreement-123",
        bodyParameters: ["Arjun Dev", "14 Jul 2026", "Expiring in 30 days"],
      })
    );

    // Owner message verification
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+912222222222", // Owner Profile phone
        templateName: OWNER_RENEWAL_ALERT_TEMPLATE_NAME,
        idempotencyKey: "owner_renewal_alert_30_day_reminder:agreement-123",
        bodyParameters: ["Arjun Dev", "204", "Expiring in 30 days", "14 Jul 2026", "+919999988888"],
      })
    );

    // Verify event logging
    expect(eventLog.log).toHaveBeenCalledWith(
      "tenant_renewal_whatsapp_sent",
      "owner-999",
      expect.objectContaining({ agreement_id: "agreement-123", stage: "30_DAY_REMINDER" }),
      "tenant-456"
    );
    expect(eventLog.log).toHaveBeenCalledWith(
      "owner_renewal_whatsapp_sent",
      "owner-999",
      expect.objectContaining({ agreement_id: "agreement-123", stage: "30_DAY_REMINDER" }),
      "tenant-456"
    );
  });

  it("sends 15-day reminder when exactly 15 days remain", async () => {
    const now = new Date("2026-06-29T00:00:00.000Z"); // 15 days before July 14
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.2" });

    const result = await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(true);
    expect(result.ownerSent).toBe(true);

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919999988888",
        templateName: AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME,
        idempotencyKey: "agreement_renewal_15_day_reminder:agreement-123",
        bodyParameters: ["Arjun Dev", "14 Jul 2026", "Expiring in 15 days"],
      })
    );
  });

  it("sends expiry alert today when 0 days remain", async () => {
    const now = new Date("2026-07-14T00:00:00.000Z"); // July 14
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.3" });

    const result = await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(true);
    expect(result.ownerSent).toBe(true);

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919999988888",
        templateName: AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
        idempotencyKey: "agreement_renewal_expiry_day_alert:agreement-123",
        bodyParameters: ["Arjun Dev", "14 Jul 2026", "Expires Today"],
      })
    );
  });

  it("sends 7-day overdue alert when 7 days overdue", async () => {
    const now = new Date("2026-07-21T00:00:00.000Z"); // 7 days after July 14
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.4" });

    // Since it's expired, evaluateAgreement expects status to reflect expired/decision pending or similar
    const expiredAgreement = {
      ...baseAgreement,
      status: "AGREEMENT_EXPIRED",
    };

    const result = await agreementRenewalNotificationService.processRenewalNotifications(expiredAgreement, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(true);
    expect(result.ownerSent).toBe(true);

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919999988888",
        templateName: AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
        idempotencyKey: "agreement_renewal_7_day_overdue:agreement-123",
        bodyParameters: ["Arjun Dev", "14 Jul 2026", "Overdue by 7 days"],
      })
    );
  });

  it("sends 30-day critical overdue alert when 30 days overdue", async () => {
    const now = new Date("2026-08-13T00:00:00.000Z"); // 30 days overdue (grace period is 30, so day 30 is the critical edge)
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.5" });

    const expiredAgreement = {
      ...baseAgreement,
      status: "AGREEMENT_EXPIRED",
    };

    const result = await agreementRenewalNotificationService.processRenewalNotifications(expiredAgreement, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(true);
    expect(result.ownerSent).toBe(true);

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919999988888",
        templateName: AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
        idempotencyKey: "agreement_renewal_30_day_critical:agreement-123",
        bodyParameters: ["Arjun Dev", "14 Jul 2026", "Critical Overdue"],
      })
    );
  });

  it("sends EXPIRED_RENT_OVERDUE alert if expired and rent is overdue", async () => {
    const now = new Date("2026-07-20T00:00:00.000Z"); // expired but not at 7-day milestone
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.6" });

    const expiredAgreementWithOverdueRent = {
      ...baseAgreement,
      status: "AGREEMENT_EXPIRED",
      tenant: {
        ...baseAgreement.tenant,
        rent_obligations: [
          {
            status: "PENDING",
            is_superseded: false,
            due_date: new Date("2026-07-05T00:00:00.000Z"),
            total_amount: 8000,
          },
        ],
      },
    };

    const result = await agreementRenewalNotificationService.processRenewalNotifications(expiredAgreementWithOverdueRent, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(true);
    expect(result.ownerSent).toBe(true);

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919999988888",
        templateName: AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
        idempotencyKey: "agreement_renewal_expired_rent_overdue:agreement-123",
        bodyParameters: ["Arjun Dev", "14 Jul 2026", "Rent Overdue"],
      })
    );
  });

  it("skips tenant send when duplicate via idempotency", async () => {
    const now = new Date("2026-06-14T00:00:00.000Z");
    
    // First call returns skipped: true for both
    mockDeliverySend.mockResolvedValue({ sent: false, skipped: true });

    const result = await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(false);
    expect(result.ownerSent).toBe(false);

    // Verify no success audit logs were written
    expect(eventLog.log).not.toHaveBeenCalledWith("tenant_renewal_whatsapp_sent", expect.anything(), expect.anything(), expect.anything());
    expect(eventLog.log).not.toHaveBeenCalledWith("owner_renewal_whatsapp_sent", expect.anything(), expect.anything(), expect.anything());
  });

  it("prioritizes milestone days (e.g. 7-day overdue) over general EXPIRED_RENT_OVERDUE", async () => {
    const now = new Date("2026-07-21T00:00:00.000Z"); // Exactly 7 days overdue
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.4" });

    const expiredAgreementWithOverdueRent = {
      ...baseAgreement,
      status: "AGREEMENT_EXPIRED",
      tenant: {
        ...baseAgreement.tenant,
        rent_obligations: [
          {
            status: "PENDING",
            is_superseded: false,
            due_date: new Date("2026-07-05T00:00:00.000Z"),
            total_amount: 8000,
          },
        ],
      },
    };

    const result = await agreementRenewalNotificationService.processRenewalNotifications(expiredAgreementWithOverdueRent, now);

    expect(result.skipped).toBe(false);
    expect(result.tenantSent).toBe(true);
    expect(result.ownerSent).toBe(true);

    // Should prioritize 7_DAY_OVERDUE instead of EXPIRED_RENT_OVERDUE
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919999988888",
        templateName: AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
        idempotencyKey: "agreement_renewal_7_day_overdue:agreement-123",
        bodyParameters: ["Arjun Dev", "14 Jul 2026", "Overdue by 7 days"],
      })
    );
  });

  it("catches up a missed 30-day reminder when cron resumes at 25 days remaining", async () => {
    const now = new Date("2026-06-19T00:00:00.000Z"); // 25 days before July 14 — cron missed day 30
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.catchup1" });

    const result = await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

    expect(result.tenantSent).toBe(true);
    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "agreement_renewal_30_day_reminder:agreement-123" })
    );
  });

  it("prefers the 15-day reminder over the 30-day reminder once inside the 15-day window", async () => {
    const now = new Date("2026-07-02T00:00:00.000Z"); // 12 days before July 14
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.catchup2" });

    await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "agreement_renewal_15_day_reminder:agreement-123" })
    );
    expect(mockDeliverySend).not.toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "agreement_renewal_30_day_reminder:agreement-123" })
    );
  });

  it("catches up a missed 7-day-overdue alert before the grace-period critical threshold", async () => {
    const now = new Date("2026-07-30T00:00:00.000Z"); // 16 days overdue, grace period 30 — cron missed day 7
    mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.catchup3" });
    const expiredAgreement = { ...baseAgreement, status: "AGREEMENT_EXPIRED" };

    await agreementRenewalNotificationService.processRenewalNotifications(expiredAgreement, now);

    expect(mockDeliverySend).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "agreement_renewal_7_day_overdue:agreement-123" })
    );
  });

  it("checks templates health correctly", async () => {
    const mockVerify = vi.fn();
    const { whatsAppTemplateDeliveryService } = await import("@/lib/services/notifications/whatsapp-template-delivery");
    whatsAppTemplateDeliveryService.verifyTemplateHealth = mockVerify;

    mockVerify.mockResolvedValue({ exists: true, status: "APPROVED" });

    const results = await agreementRenewalNotificationService.checkTemplatesHealth();
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ name: AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME, exists: true, status: "APPROVED" });
  });
});

