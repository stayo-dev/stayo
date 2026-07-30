import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agreementFindMany: vi.fn(),
  agreementUpdate: vi.fn(),
  agreementUpdateMany: vi.fn(async () => ({ count: 1 })),
  tenantsUpdate: vi.fn(),
  eventLogLog: vi.fn(),
  queryRaw: vi.fn(),
  moveOutFindFirst: vi.fn().mockResolvedValue(null),
  depositFindFirst: vi.fn().mockResolvedValue(null),
  generateForAgreementInTx: vi.fn().mockResolvedValue({ created: 12, updated: 0, skipped: 0, months: [] }),
  notifyActivated: vi.fn(),
  expireStaleOffers: vi.fn().mockResolvedValue({ expiredCount: 0 }),
  registerEvent: vi.fn().mockResolvedValue({ id: "event-1" }),
  transaction: vi.fn(async (cb: any) => cb({
    $queryRaw: mocks.queryRaw,
    agreement: { update: mocks.agreementUpdate, updateMany: mocks.agreementUpdateMany },
    tenants: { update: mocks.tenantsUpdate },
    move_out_requests: { findFirst: mocks.moveOutFindFirst },
    rent_obligations: { findFirst: mocks.depositFindFirst },
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agreement: {
      findMany: mocks.agreementFindMany,
      update: mocks.agreementUpdate,
    },
    move_out_requests: {
      findFirst: mocks.moveOutFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/src/services/payments/agreement-rent-schedule-service", () => ({
  agreementRentScheduleService: {
    generateForAgreementInTx: mocks.generateForAgreementInTx,
  },
}));

vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: {
    notifyActivated: mocks.notifyActivated,
  },
}));

vi.mock("@/lib/cache/dashboard-cache", () => ({
  invalidateHostelDashboardCache: vi.fn(),
  invalidateOwnerDashboardCache: vi.fn(),
}));

vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: { log: mocks.eventLogLog },
}));

vi.mock("@/lib/services/notification-service", () => ({
  notificationService: { createNotification: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/src/services/tenants/agreement-renewal-notification-service", () => ({
  agreementRenewalNotificationService: {
    checkTemplatesHealth: vi.fn().mockResolvedValue([]),
    processRenewalNotifications: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/src/services/tenants/renewal-offer-service", () => ({
  renewalOfferService: { expireStaleOffers: mocks.expireStaleOffers },
}));

vi.mock("@/src/services/tenants/renewal-timeline-service", () => ({
  renewalTimelineService: { registerEvent: mocks.registerEvent },
}));

import { AgreementLifecycleService } from "@/src/services/tenants/agreement-lifecycle-service";

describe("AgreementRenewalActivation", () => {
  let service: AgreementLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgreementLifecycleService();
  });

  it("activates scheduled renewals when the effective date arrives and there are no unpaid deposits", async () => {
    const today = new Date("2026-07-01T00:00:00.000Z");

    const mockDraft = {
      id: "draft-agreement-id",
      tenant_id: "tenant-id",
      hostel_id: "hostel-id",
      status: "DRAFT",
      agreement_start_date: today,
      agreement_end_date: new Date("2027-06-30T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 6000,
      contract_maintenance: 1000,
      contract_maintenance_type: "MONTHLY",
      contract_payment_frequency: "MONTHLY",
      template_id: "template-id",
      content_snapshot: {
        source: "renewal_offer",
        renewal_offer_id: "offer-id",
      },
      tenant: {
        owner_id: "owner-id",
        profiles: { name: "Adithya" },
        rent_obligations: [], // no unpaid deposit obligations
      },
      template: {
        owner_signature_url: "owner-signature-template",
        owner_name: "Owner Name",
        rules_content: { rules: [] },
        version_number: 1,
      },
      renewed_from_agreement: {
        id: "predecessor-agreement-id",
        status: "SIGNED",
        renewed_to_agreement_id: "draft-agreement-id",
        tenant_signature_url: "tenant-signature-predecessor",
        tenant_signature_name: "Tenant Name",
        tenant_signed_at: new Date("2026-01-01T00:00:00.000Z"),
        tenant_ip: "127.0.0.1",
        tenant_user_agent: "Mozilla",
        guardian_signature_url: "guardian-signature-predecessor",
        guardian_signature_name: "Guardian Name",
        guardian_relation: "Father",
        guardian_signed_at: new Date("2026-01-01T00:00:00.000Z"),
        guardian_ip: "127.0.0.1",
        guardian_user_agent: "Mozilla",
        owner_signature_url: "owner-signature-predecessor",
        owner_signature_name: "Owner Name",
        rules_snapshot: { rules: ["Existing Rules"] },
        rule_version_id: "rule-v1",
        rule_version_number: "v1",
        content_snapshot: {
          tenant_name: "Adithya",
          room_no: "101",
        },
      },
    };

    mocks.agreementFindMany.mockResolvedValue([mockDraft]);

    const summary = {
      checked: 0,
      marked_expiring: 0,
      marked_expired: 0,
      reminders_30d: 0,
      reminders_15d: 0,
      expiry_notifications: 0,
      skipped_legacy: 0,
      failed: 0,
      errors: [],
      renewals_activated: 0,
      offers_expired: 0,
    };

    const touchedOwnerIds = new Set<string>();
    const touchedHostelIds = new Set<string>();

    await service.activateScheduledRenewals(today, summary, touchedOwnerIds, touchedHostelIds);

    expect(summary.renewals_activated).toBe(1);
    expect(summary.failed).toBe(0);
    expect(touchedOwnerIds.has("owner-id")).toBe(true);
    expect(touchedHostelIds.has("hostel-id")).toBe(true);

    // Verify transaction updates predecessor to RENEWED (conditional, count-checked)
    expect(mocks.agreementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "predecessor-agreement-id" }),
        data: expect.objectContaining({ status: "RENEWED" }),
      })
    );

    // Verify transaction updates draft to SIGNED with copied credentials (conditional, count-checked)
    expect(mocks.agreementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "draft-agreement-id" }),
        data: expect.objectContaining({
          status: "SIGNED",
          tenant_signature_url: "tenant-signature-predecessor",
          tenant_signature_name: "Tenant Name",
          tenant_signed_at: mockDraft.renewed_from_agreement.tenant_signed_at,
          tenant_ip: "127.0.0.1",
          tenant_user_agent: "Mozilla",
          owner_signature_url: "owner-signature-predecessor",
          owner_signature_name: "Owner Name",
          rules_snapshot: { rules: ["Existing Rules"] },
          rule_version_id: "rule-v1",
          rule_version_number: "v1",
        }),
      })
    );

    // Verify transaction updates tenants model active parameters
    expect(mocks.tenantsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tenant-id" },
        data: expect.objectContaining({
          monthly_rent: 8500,
          security_deposit: 6000,
          maintenance_charge: 1000,
          maintenance_type: "MONTHLY",
        }),
      })
    );

    // Verify content snapshot was merged with predecessor details
    const updateCall = mocks.agreementUpdateMany.mock.calls.find(
      (call: any) => call[0].where.id === "draft-agreement-id"
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0].data.content_snapshot).toEqual(
      expect.objectContaining({
        tenant_name: "Adithya",
        room_no: "101",
        source: "renewal_offer",
        renewal_offer_id: "offer-id",
        agreement_start_date: "2026-07-01",
        contract_rent: 8500,
        contract_security_deposit: 6000,
      })
    );
  });

  it("blocks activation if there is an unpaid security deposit obligation", async () => {
    const today = new Date("2026-07-01T00:00:00.000Z");

    const mockDraft = {
      id: "draft-agreement-id",
      tenant_id: "tenant-id",
      hostel_id: "hostel-id",
      status: "DRAFT",
      agreement_start_date: today,
      agreement_end_date: new Date("2027-06-30T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 6000,
      contract_maintenance: 1000,
      contract_maintenance_type: "MONTHLY",
      contract_payment_frequency: "MONTHLY",
      tenant: {
        owner_id: "owner-id",
        profiles: { name: "Adithya" },
      },
      renewed_from_agreement: {
        id: "predecessor-agreement-id",
        status: "SIGNED",
        renewed_to_agreement_id: "draft-agreement-id",
      },
    };

    mocks.agreementFindMany.mockResolvedValue([mockDraft]);
    mocks.depositFindFirst.mockResolvedValueOnce({ id: "ob-1", amount: 1000 });

    const summary = {
      checked: 0,
      marked_expiring: 0,
      marked_expired: 0,
      reminders_30d: 0,
      reminders_15d: 0,
      expiry_notifications: 0,
      skipped_legacy: 0,
      failed: 0,
      errors: [],
      renewals_activated: 0,
      offers_expired: 0,
    };

    const touchedOwnerIds = new Set<string>();
    const touchedHostelIds = new Set<string>();

    await service.activateScheduledRenewals(today, summary, touchedOwnerIds, touchedHostelIds);

    expect(summary.renewals_activated).toBe(0);
    expect(summary.failed).toBe(0); // not a failure/throw, just skipped/blocked
    expect(mocks.agreementUpdate).not.toHaveBeenCalled();
    expect(mocks.agreementUpdateMany).not.toHaveBeenCalled();

    // Verify blocking event was logged
    expect(mocks.eventLogLog).toHaveBeenCalledWith(
      "RENEWAL_ACTIVATION_BLOCKED",
      "owner-id",
      expect.objectContaining({
        agreement_id: "draft-agreement-id",
        reason: "Unpaid security deposit top-up obligation",
        obligation_id: "ob-1",
        amount: 1000,
      }),
      "tenant-id"
    );
  });

  it("generates the rent schedule for the activated draft inside the same transaction", async () => {
    const today = new Date("2026-07-01T00:00:00.000Z");
    const mockDraft = {
      id: "draft-agreement-id",
      tenant_id: "tenant-id",
      hostel_id: "hostel-id",
      status: "DRAFT",
      agreement_start_date: today,
      agreement_end_date: new Date("2027-06-30T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 6000,
      contract_maintenance: 1000,
      contract_maintenance_type: "MONTHLY",
      contract_payment_frequency: "MONTHLY",
      template_id: "template-id",
      content_snapshot: {
        source: "renewal_offer",
        renewal_offer_id: "offer-id",
      },
      tenant: {
        owner_id: "owner-id",
        profiles: { name: "Adithya" },
        rent_obligations: [],
      },
      template: {
        owner_signature_url: "owner-signature-template",
        owner_name: "Owner Name",
        rules_content: { rules: [] },
        version_number: 1,
      },
      renewed_from_agreement: {
        id: "predecessor-agreement-id",
        status: "SIGNED",
        renewed_to_agreement_id: "draft-agreement-id",
        tenant_signature_url: "tenant-signature-predecessor",
        tenant_signature_name: "Tenant Name",
        tenant_signed_at: new Date("2026-01-01T00:00:00.000Z"),
        tenant_ip: "127.0.0.1",
        tenant_user_agent: "Mozilla",
        guardian_signature_url: "guardian-signature-predecessor",
        guardian_signature_name: "Guardian Name",
        guardian_relation: "Father",
        guardian_signed_at: new Date("2026-01-01T00:00:00.000Z"),
        guardian_ip: "127.0.0.1",
        guardian_user_agent: "Mozilla",
        owner_signature_url: "owner-signature-predecessor",
        owner_signature_name: "Owner Name",
        rules_snapshot: { rules: ["Existing Rules"] },
        rule_version_id: "rule-v1",
        rule_version_number: "v1",
        content_snapshot: {
          tenant_name: "Adithya",
          room_no: "101",
        },
      },
    };

    mocks.agreementFindMany.mockResolvedValue([mockDraft]);

    const summary = {
      checked: 0,
      marked_expiring: 0,
      marked_expired: 0,
      reminders_30d: 0,
      reminders_15d: 0,
      expiry_notifications: 0,
      skipped_legacy: 0,
      failed: 0,
      errors: [],
      renewals_activated: 0,
      offers_expired: 0,
    };

    const touchedOwnerIds = new Set<string>();
    const touchedHostelIds = new Set<string>();

    await service.activateScheduledRenewals(today, summary, touchedOwnerIds, touchedHostelIds);

    expect(summary.renewals_activated).toBe(1);
    expect(mocks.generateForAgreementInTx).toHaveBeenCalledWith(
      expect.anything(),
      "draft-agreement-id"
    );
    expect(mocks.notifyActivated).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-id", ownerId: "owner-id", hostelId: "hostel-id" })
    );
    expect(mocks.registerEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "RENEWAL_ACTIVATED", actorType: "SYSTEM" })
    );
  });

  it("blocks activation when the predecessor is no longer in a renewable status", async () => {
    const today = new Date("2026-07-01T00:00:00.000Z");
    const mockDraft = {
      id: "draft-agreement-id",
      tenant_id: "tenant-id",
      hostel_id: "hostel-id",
      status: "DRAFT",
      agreement_start_date: today,
      tenant: { owner_id: "owner-id", profiles: { name: "Adithya" }, rent_obligations: [] },
      renewed_from_agreement: { id: "predecessor-agreement-id", status: "TERMINATED" },
    };
    mocks.agreementFindMany.mockResolvedValue([mockDraft]);

    const summary = {
      checked: 0, marked_expiring: 0, marked_expired: 0, reminders_30d: 0, reminders_15d: 0,
      expiry_notifications: 0, skipped_legacy: 0, failed: 0, errors: [], renewals_activated: 0, offers_expired: 0,
    };

    await service.activateScheduledRenewals(today, summary, new Set(), new Set());

    expect(summary.renewals_activated).toBe(0);
    expect(summary.failed).toBe(0);
    expect(mocks.agreementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.eventLogLog).toHaveBeenCalledWith(
      "RENEWAL_ACTIVATION_BLOCKED",
      "owner-id",
      expect.objectContaining({
        agreement_id: "draft-agreement-id",
        reason: "Predecessor agreement is not in a renewable status",
        predecessor_status: "TERMINATED",
      }),
      "tenant-id"
    );
    expect(mocks.registerEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        hostelId: "hostel-id",
        tenantId: "tenant-id",
        agreementId: "draft-agreement-id",
        eventType: "RENEWAL_ACTIVATION_BLOCKED",
        actorType: "SYSTEM",
        reason: "Predecessor agreement is not in a renewable status",
      })
    );
  });

  it("blocks activation when the tenant has an active move-out request", async () => {
    const today = new Date("2026-07-01T00:00:00.000Z");
    mocks.moveOutFindFirst.mockResolvedValueOnce({ id: "move-1", status: "REQUESTED" });
    const mockDraft = {
      id: "draft-agreement-id",
      tenant_id: "tenant-id",
      hostel_id: "hostel-id",
      status: "DRAFT",
      agreement_start_date: today,
      agreement_end_date: new Date("2027-06-30T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 6000,
      contract_maintenance: 1000,
      contract_maintenance_type: "MONTHLY",
      contract_payment_frequency: "MONTHLY",
      tenant: { owner_id: "owner-id", profiles: { name: "Adithya" }, rent_obligations: [] },
      renewed_from_agreement: { id: "predecessor-agreement-id", status: "SIGNED", renewed_to_agreement_id: "draft-agreement-id" },
    };
    mocks.agreementFindMany.mockResolvedValue([mockDraft]);

    const summary = {
      checked: 0, marked_expiring: 0, marked_expired: 0, reminders_30d: 0, reminders_15d: 0,
      expiry_notifications: 0, skipped_legacy: 0, failed: 0, errors: [], renewals_activated: 0, offers_expired: 0,
    };

    await service.activateScheduledRenewals(today, summary, new Set(), new Set());

    expect(summary.renewals_activated).toBe(0);
    expect(mocks.agreementUpdateMany).not.toHaveBeenCalled();
    expect(mocks.eventLogLog).toHaveBeenCalledWith(
      "RENEWAL_ACTIVATION_BLOCKED",
      "owner-id",
      expect.objectContaining({
        agreement_id: "draft-agreement-id",
        reason: "Move-out already in progress",
        move_out_request_id: "move-1",
      }),
      "tenant-id"
    );
  });

  it("fails activation instead of silently proceeding when the predecessor's status changed concurrently", async () => {
    const today = new Date("2026-07-01T00:00:00.000Z");
    mocks.agreementUpdateMany.mockResolvedValueOnce({ count: 0 });
    const mockDraft = {
      id: "draft-agreement-id",
      tenant_id: "tenant-id",
      hostel_id: "hostel-id",
      status: "DRAFT",
      agreement_start_date: today,
      agreement_end_date: new Date("2027-06-30T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 6000,
      contract_maintenance: 1000,
      contract_maintenance_type: "MONTHLY",
      contract_payment_frequency: "MONTHLY",
      template_id: "template-id",
      content_snapshot: { source: "renewal_offer", renewal_offer_id: "offer-id" },
      tenant: { owner_id: "owner-id", profiles: { name: "Adithya" }, rent_obligations: [] },
      template: { owner_signature_url: "url", owner_name: "Owner", rules_content: { rules: [] }, version_number: 1 },
      renewed_from_agreement: {
        id: "predecessor-agreement-id",
        status: "SIGNED",
        renewed_to_agreement_id: "draft-agreement-id",
        tenant_signature_url: "s", tenant_signature_name: "n", tenant_signed_at: today,
        tenant_ip: "127.0.0.1", tenant_user_agent: "UA",
        guardian_signature_url: null, guardian_signature_name: null, guardian_relation: null,
        guardian_signed_at: null, guardian_ip: null, guardian_user_agent: null,
        owner_signature_url: "o", owner_signature_name: "Owner",
        rules_snapshot: { rules: [] }, rule_version_id: "rule-v1", rule_version_number: "v1",
        content_snapshot: {},
      },
    };
    mocks.agreementFindMany.mockResolvedValue([mockDraft]);

    const summary = {
      checked: 0, marked_expiring: 0, marked_expired: 0, reminders_30d: 0, reminders_15d: 0,
      expiry_notifications: 0, skipped_legacy: 0, failed: 0, errors: [] as string[], renewals_activated: 0, offers_expired: 0,
    };

    await service.activateScheduledRenewals(today, summary, new Set(), new Set());

    expect(summary.renewals_activated).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]).toMatch(/Renewal chain changed during cron activation/);
  });

  it("expires stale renewal offers as part of the daily lifecycle run", async () => {
    mocks.agreementFindMany.mockResolvedValue([]);
    mocks.expireStaleOffers.mockResolvedValue({ expiredCount: 3 });

    const summary = await service.processDailyLifecycle(new Date("2026-07-01T00:00:00.000Z"));

    expect(mocks.expireStaleOffers).toHaveBeenCalledTimes(1);
    expect(summary.offers_expired).toBe(3);
  });
});
