import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementRenewalError, AgreementRenewalService } from "@/src/services/tenants/agreement-renewal-service";

const { registerEvent } = vi.hoisted(() => ({ registerEvent: vi.fn().mockResolvedValue({ id: "event-1" }) }));
vi.mock("@/src/services/tenants/renewal-timeline-service", () => ({
  renewalTimelineService: { registerEvent },
}));

const sourceAgreement = {
  id: "agreement-1",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  template_id: "template-1",
  status: "AGREEMENT_EXPIRED",
  agreement_version: 2,
  agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
  agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
  agreement_duration_months: 12,
  contract_rent: 8500,
  contract_security_deposit: 10000,
  contract_maintenance: 1400,
  contract_maintenance_type: "ONE_TIME",
  contract_payment_frequency: "MONTHLY",
  content_snapshot: {
    hostel_name: "Sri Adithya",
    tenant_name: "Tenant One",
    monthly_rent: 8000,
    advance_deposit: 9000,
    maintenance_charge: 1000,
    maintenance_type: "MONTHLY",
    payment_frequency: "QUARTERLY",
  },
  tenant: {
    id: "tenant-1",
    status: "ACTIVE",
    owner_id: "owner-1",
    hostel_id: "hostel-1",
  },
  renewed_to_agreement: null,
  renewed_agreements: [],
};

const renewalLifecycleInput = {
  agreement_start_date: "2027-06-14",
  agreement_end_date: "2028-06-14",
  agreement_duration_months: 12,
};

function createDb(overrides: Partial<typeof sourceAgreement> = {}, activeMoveOut: any = null) {
  const agreement = { ...sourceAgreement, ...overrides };
  const tx = {
    $queryRaw: vi.fn(),
    agreement: {
      findUnique: vi.fn().mockResolvedValue(agreement),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        ...data,
        generated_at: new Date("2026-06-14T00:00:00.000Z"),
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    move_out_requests: {
      findFirst: vi.fn().mockResolvedValue(activeMoveOut),
    },
    tenants: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    tenant_financial_ledger: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    rent_obligations: {
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    roomAllocation: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agreementTemplate: {
      findFirst: vi.fn().mockResolvedValue({
        id: "template-1",
        owner_name: "Owner",
        owner_signature_url: "sig-url",
      }),
    },
    tenant_billing_plans: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    move_out_requests_write: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const db = {
    $transaction: vi.fn(async (callback: any) => callback(tx)),
  };

  return { db, tx, agreement };
}

describe("AgreementRenewalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a linked draft renewal from an expired agreement", async () => {
    const { db, tx } = createDb();
    const service = new AgreementRenewalService(db as any);

    const result = await service.createRenewalDraft("agreement-1", renewalLifecycleInput);

    expect(tx.agreement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        template_id: "template-1",
        renewed_from_agreement_id: "agreement-1",
        status: "DRAFT",
        agreement_version: 3,
        agreement_start_date: new Date("2027-06-14T00:00:00.000Z"),
        agreement_end_date: new Date("2028-06-14T00:00:00.000Z"),
        agreement_duration_months: 12,
        contract_rent: 8500,
        contract_security_deposit: 10000,
        contract_maintenance: 1400,
        contract_maintenance_type: "ONE_TIME",
        contract_payment_frequency: "MONTHLY",
      }),
    });
    expect(tx.agreement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "agreement-1",
        renewed_to_agreement_id: null,
      },
      data: {
        renewed_to_agreement_id: result.renewalDraft.id,
      },
    });
    expect(registerEvent).toHaveBeenCalledWith(tx, {
      hostelId: "hostel-1",
      tenantId: "tenant-1",
      agreementId: result.renewalDraft.id,
      eventType: "DRAFT_CREATED",
      actorType: "SYSTEM",
    });
  });

  it("preserves contract values in the renewal content snapshot", async () => {
    const { db, tx } = createDb();
    const service = new AgreementRenewalService(db as any);

    await service.createRenewalDraft("agreement-1", renewalLifecycleInput);

    const created = tx.agreement.create.mock.calls[0][0].data;
    expect(created.content_snapshot).toMatchObject({
      hostel_name: "Sri Adithya",
      tenant_name: "Tenant One",
      monthly_rent: 8500,
      advance_deposit: 10000,
      maintenance_charge: 1400,
      maintenance_type: "ONE_TIME",
      payment_frequency: "MONTHLY",
      renewed_from_agreement_id: "agreement-1",
      previous_agreement_version: 2,
      agreement_start_date: "2027-06-14",
      agreement_end_date: "2028-06-14",
      agreement_duration_months: 12,
    });
  });

  it.each(["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"])("allows renewal from %s", async (status) => {
    const { db, tx } = createDb({ status });
    const service = new AgreementRenewalService(db as any);

    await expect(service.createRenewalDraft("agreement-1", renewalLifecycleInput)).resolves.toBeTruthy();
    expect(tx.agreement.create).toHaveBeenCalledTimes(1);
  });

  it.each(["RENEWED", "TERMINATED", "VOID", "DRAFT"])("blocks renewal from %s", async (status) => {
    const { db, tx } = createDb({ status });
    const service = new AgreementRenewalService(db as any);

    await expect(service.createRenewalDraft("agreement-1", renewalLifecycleInput)).rejects.toMatchObject({
      code: "AGREEMENT_NOT_RENEWABLE",
      status: 409,
    });
    expect(tx.agreement.create).not.toHaveBeenCalled();
  });

  it("prevents duplicate renewal when a successor is already linked", async () => {
    const { db, tx } = createDb({
      renewed_to_agreement: {
        id: "agreement-2",
        status: "DRAFT",
      },
    } as any);
    const service = new AgreementRenewalService(db as any);

    await expect(service.createRenewalDraft("agreement-1", renewalLifecycleInput)).rejects.toMatchObject({
      code: "AGREEMENT_SUCCESSOR_EXISTS",
      details: expect.objectContaining({
        successorAgreementId: "agreement-2",
      }),
    });
    expect(tx.agreement.create).not.toHaveBeenCalled();
  });

  it("blocks renewal while move-out is in progress", async () => {
    const { db, tx } = createDb({}, { id: "move-out-1", status: "REQUESTED" });
    const service = new AgreementRenewalService(db as any);

    await expect(service.createRenewalDraft("agreement-1", renewalLifecycleInput)).rejects.toMatchObject({
      code: "MOVE_OUT_IN_PROGRESS",
      details: expect.objectContaining({
        moveOutRequestId: "move-out-1",
        moveOutStatus: "REQUESTED",
      }),
    });
    expect(tx.agreement.create).not.toHaveBeenCalled();
  });

  it("does not touch tenant status, room allocation, rent, billing, deposits, or move-out records", async () => {
    const { db, tx } = createDb();
    const service = new AgreementRenewalService(db as any);

    await service.createRenewalDraft("agreement-1", renewalLifecycleInput);

    expect(tx.tenants.update).not.toHaveBeenCalled();
    expect(tx.tenants.updateMany).not.toHaveBeenCalled();
    expect(tx.roomAllocation.create).not.toHaveBeenCalled();
    expect(tx.roomAllocation.update).not.toHaveBeenCalled();
    expect(tx.roomAllocation.updateMany).not.toHaveBeenCalled();
    expect(tx.rent_obligations.create).not.toHaveBeenCalled();
    expect(tx.rent_obligations.createMany).not.toHaveBeenCalled();
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
    expect(tx.rent_obligations.updateMany).not.toHaveBeenCalled();
    expect(tx.tenant_billing_plans.create).not.toHaveBeenCalled();
    expect(tx.tenant_billing_plans.updateMany).not.toHaveBeenCalled();
    expect(tx.tenant_financial_ledger.create).not.toHaveBeenCalled();
    expect(tx.tenant_financial_ledger.update).not.toHaveBeenCalled();
    expect(tx.tenant_financial_ledger.updateMany).not.toHaveBeenCalled();
    expect(tx.move_out_requests_write.create).not.toHaveBeenCalled();
    expect(tx.move_out_requests_write.update).not.toHaveBeenCalled();
    expect(tx.move_out_requests_write.updateMany).not.toHaveBeenCalled();
  });

  it("requires explicit lifecycle dates before creating a renewal draft if source agreement and snapshot lack them", async () => {
    const { db, tx } = createDb({
      agreement_start_date: null,
      agreement_end_date: null,
      agreement_duration_months: null,
      content_snapshot: {
        hostel_name: "Sri Adithya",
        tenant_name: "Tenant One",
        monthly_rent: 8000,
        advance_deposit: 9000,
        maintenance_charge: 1000,
        maintenance_type: "MONTHLY",
        payment_frequency: "QUARTERLY",
        agreement_start_date: null,
        agreement_end_date: null,
        agreement_duration_months: null,
        joining_date: null,
        billing_start_date: null,
      },
    });
    const service = new AgreementRenewalService(db as any);

    await expect(service.createRenewalDraft("agreement-1")).rejects.toMatchObject({
      code: "AGREEMENT_LIFECYCLE_INCOMPLETE",
      status: 409,
      details: expect.objectContaining({
        missingFields: expect.arrayContaining([
          "agreement_start_date",
          "agreement_end_date",
          "agreement_duration_months",
        ]),
      }),
    });
    expect(tx.agreement.create).not.toHaveBeenCalled();
  });

  it("successfully creates a renewal draft with defaulted dates when not provided in input", async () => {
    const { db, tx } = createDb();
    const service = new AgreementRenewalService(db as any);

    const result = await service.createRenewalDraft("agreement-1");
    expect(result.renewalDraft).toBeTruthy();
    expect(result.renewalDraft.agreement_start_date.toISOString()).toBe("2027-06-14T00:00:00.000Z");
    expect(result.renewalDraft.agreement_end_date.toISOString()).toBe("2028-06-14T00:00:00.000Z");
    expect(result.renewalDraft.agreement_duration_months).toBe(12);
    expect(tx.agreement.create).toHaveBeenCalled();
  });

  it("handles legacy source agreements by fallback to content snapshot", async () => {
    const { db, tx } = createDb({
      agreement_start_date: null,
      agreement_end_date: null,
      agreement_duration_months: null,
      content_snapshot: {
        hostel_name: "Sri Adithya",
        tenant_name: "Tenant One",
        monthly_rent: 8000,
        advance_deposit: 9000,
        maintenance_charge: 1000,
        maintenance_type: "MONTHLY",
        payment_frequency: "QUARTERLY",
        joining_date: "2026-06-14",
        duration: 12,
      },
    });
    const service = new AgreementRenewalService(db as any);

    const result = await service.createRenewalDraft("agreement-1");
    expect(result.renewalDraft).toBeTruthy();
    expect(result.renewalDraft.agreement_start_date.toISOString()).toBe("2027-06-14T00:00:00.000Z");
    expect(result.renewalDraft.agreement_end_date.toISOString()).toBe("2028-06-14T00:00:00.000Z");
    expect(result.renewalDraft.agreement_duration_months).toBe(12);
  });

  it("uses structured renewal errors", () => {
    const error = new AgreementRenewalError("MOVE_OUT_IN_PROGRESS", "Blocked", { moveOutRequestId: "move-1" });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("MOVE_OUT_IN_PROGRESS");
    expect(error.status).toBe(409);
    expect(error.details).toEqual({ moveOutRequestId: "move-1" });
  });
});
