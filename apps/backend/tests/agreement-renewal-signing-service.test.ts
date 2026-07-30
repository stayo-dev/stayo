import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgreementRenewalSigningError,
  AgreementRenewalSigningService,
} from "@/src/services/tenants/agreement-renewal-signing-service";

vi.mock("@/src/services/payments/agreement-rent-schedule-service", () => ({
  agreementRentScheduleService: {
    generateForAgreementInTx: vi.fn().mockResolvedValue({ created: 0, updated: 0, skipped: 0, months: [] }),
  },
}));

const { registerEvent } = vi.hoisted(() => ({ registerEvent: vi.fn().mockResolvedValue({ id: "event-1" }) }));
vi.mock("@/src/services/tenants/renewal-timeline-service", () => ({
  renewalTimelineService: { registerEvent },
}));

const predecessorBase = {
  id: "agreement-1",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  template_id: "template-1",
  status: "SIGNED",
  renewed_to_agreement_id: "agreement-2",
  agreement_version: 1,
  agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
  agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
  agreement_duration_months: 12,
  content_snapshot: { tenant_name: "Tenant One" },
  pdf_url: "https://cdn.example.com/agreement-1.pdf",
  contract_rent: 8500,
  contract_security_deposit: 10000,
  contract_maintenance: 1400,
  contract_maintenance_type: "ONE_TIME",
  contract_payment_frequency: "MONTHLY",
};

const renewalBase = {
  id: "agreement-2",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  template_id: "template-1",
  renewed_from_agreement_id: "agreement-1",
  status: "DRAFT",
  agreement_version: 2,
  agreement_start_date: new Date("2027-06-14T00:00:00.000Z"),
  agreement_end_date: new Date("2028-06-14T00:00:00.000Z"),
  agreement_duration_months: 12,
  content_snapshot: { tenant_name: "Tenant One", previous_agreement_version: 1 },
  pdf_url: null,
  contract_rent: 8500,
  contract_security_deposit: 10000,
  contract_maintenance: 1400,
  contract_maintenance_type: "ONE_TIME",
  contract_payment_frequency: "MONTHLY",
  template: {
    id: "template-1",
    owner_name: "Owner One",
    owner_signature_url: "https://cdn.example.com/owner-signature.png",
  },
  tenant: {
    id: "tenant-1",
    owner_id: "owner-1",
    hostel_id: "hostel-1",
  },
};

function createDb(options: {
  renewal?: Partial<typeof renewalBase> | null;
  predecessor?: Partial<typeof predecessorBase> | null;
  activeMoveOut?: any;
  unpaidDeposit?: any;
} = {}) {
  const predecessor = options.predecessor === null ? null : { ...predecessorBase, ...options.predecessor };
  const renewal = options.renewal === null
    ? null
    : {
        ...renewalBase,
        ...options.renewal,
        renewed_from_agreement: predecessor,
      };
  const records = new Map<string, any>();
  if (predecessor) records.set(predecessor.id, { ...predecessor });
  if (renewal) records.set(renewal.id, { ...renewal });

  const tx = {
    $queryRaw: vi.fn(),
    agreement: {
      findUnique: vi.fn(async ({ where }: any) => {
        const record = records.get(where.id);
        if (!record) return null;
        if (where.id === renewalBase.id) {
          return {
            ...record,
            renewed_from_agreement: records.get(record.renewed_from_agreement_id) || null,
            template: renewalBase.template,
            tenant: renewalBase.tenant,
          };
        }
        return { ...record };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const record = records.get(where.id);
        if (!record) return { count: 0 };
        if (where.status) {
          const allowed = Array.isArray(where.status.in) ? where.status.in : [where.status];
          if (!allowed.includes(record.status)) return { count: 0 };
        }
        if (where.renewed_to_agreement_id && record.renewed_to_agreement_id !== where.renewed_to_agreement_id) {
          return { count: 0 };
        }
        if (where.renewed_from_agreement_id && record.renewed_from_agreement_id !== where.renewed_from_agreement_id) {
          return { count: 0 };
        }
        records.set(where.id, { ...record, ...data });
        return { count: 1 };
      }),
      update: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    agreementTemplate: {
      findFirst: vi.fn(async () => ({
        id: "template-1",
        version: "v1",
        title: "Standard Tenant Agreement",
        owner_name: "Owner One",
        rules_content: { categories: [] },
        custom_rules: "",
        type: "RESIDENCY",
        status: "PUBLISHED",
        version_number: 1,
        is_active: true,
      })),
      create: vi.fn(async () => ({
        id: "template-1",
        version: "v1",
        title: "Standard Tenant Agreement",
        owner_name: "Owner One",
        rules_content: { categories: [] },
        custom_rules: "",
        type: "RESIDENCY",
        status: "PUBLISHED",
        version_number: 1,
        is_active: true,
      })),
    },
    ruleVersion: {
      findUnique: vi.fn(async () => ({
        id: "template-1",
        version: "v1.0",
        content: { categories: [] },
        content_snapshot: { categories: [] },
      })),
      findFirst: vi.fn(async () => ({
        id: "template-1",
        version: "v1.0",
        content: { categories: [] },
        content_snapshot: { categories: [] },
      })),
      create: vi.fn(),
    },
    move_out_requests: {
      findFirst: vi.fn().mockResolvedValue(options.activeMoveOut || null),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    tenants: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    roomAllocation: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    rent_obligations: {
      findFirst: vi.fn().mockResolvedValue(options.unpaidDeposit ?? null),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payments: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    tenant_financial_ledger: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    tenant_billing_plans: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const db = {
    $transaction: vi.fn(async (callback: any) => callback(tx)),
  };
  return { db, tx, records };
}

function createService(db: any, pdfGenerator = { generateAndUploadPdf: vi.fn().mockResolvedValue("https://cdn.example.com/agreement-2.pdf") }) {
  const activityLog = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new AgreementRenewalSigningService(db, pdfGenerator as any, activityLog as any);
  return { service, pdfGenerator, activityLog };
}

const validInput = {
  renewalAgreementId: "agreement-2",
  tenantSignature: {
    signature_url: "https://cdn.example.com/tenant-signature.png",
    signature_name: "Tenant One",
  },
  guardianSignature: {
    signature_url: "https://cdn.example.com/guardian-signature.png",
    signature_name: "Guardian One",
    relation: "Father",
  },
  signedBy: "TENANT",
  metadata: {
    ip: "127.0.0.1",
    userAgent: "vitest",
  },
};

describe("AgreementRenewalSigningService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs a renewal draft and marks the predecessor renewed", async () => {
    const { db, tx, records } = createDb();
    const { service, pdfGenerator, activityLog } = createService(db);

    const result = await service.signRenewalAgreement(validInput);

    expect(records.get("agreement-1")).toMatchObject({
      status: "RENEWED",
      renewed_to_agreement_id: "agreement-2",
      pdf_url: "https://cdn.example.com/agreement-1.pdf",
      content_snapshot: { tenant_name: "Tenant One" },
      contract_rent: 8500,
    });
    expect(records.get("agreement-2")).toMatchObject({
      status: "SIGNED",
      tenant_signature_url: "https://cdn.example.com/tenant-signature.png",
      tenant_signature_name: "Tenant One",
      guardian_signature_name: "Guardian One",
      guardian_relation: "Father",
      owner_signature_name: "Owner One",
      owner_signature_url: "https://cdn.example.com/owner-signature.png",
      agreement_version: 2,
    });
    expect(pdfGenerator.generateAndUploadPdf).toHaveBeenCalledWith("agreement-2");
    expect(activityLog.log).toHaveBeenCalledWith(
      "AGREEMENT_RENEWED",
      "owner-1",
      expect.objectContaining({
        tenant_id: "tenant-1",
        old_agreement_id: "agreement-1",
        new_agreement_id: "agreement-2",
        pdf_generated: true,
      }),
      "tenant-1"
    );
    expect(registerEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "RENEWAL_ACTIVATED", actorType: "TENANT" })
    );
    expect(result.pdfGenerated).toBe(true);
    expect(tx.agreement.updateMany).toHaveBeenCalledTimes(2);
  });

  it.each(["AGREEMENT_EXPIRED", "EXPIRING_SOON"])("signs renewal when predecessor is %s", async (status) => {
    const { db, records } = createDb({ predecessor: { status } });
    const { service } = createService(db);

    await service.signRenewalAgreement(validInput);

    expect(records.get("agreement-1").status).toBe("RENEWED");
    expect(records.get("agreement-2").status).toBe("SIGNED");
  });

  it("blocks duplicate signing when renewal is already signed", async () => {
    const { db, tx } = createDb({ renewal: { status: "SIGNED" } });
    const { service, pdfGenerator, activityLog } = createService(db);

    await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
      code: "RENEWAL_DRAFT_REQUIRED",
      status: 409,
    });
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
    expect(pdfGenerator.generateAndUploadPdf).not.toHaveBeenCalled();
    expect(activityLog.log).not.toHaveBeenCalled();
  });

  it("blocks invalid draft status", async () => {
    const { db, tx } = createDb({ renewal: { status: "VOID" } });
    const { service } = createService(db);

    await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
      code: "RENEWAL_DRAFT_REQUIRED",
    });
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
  });

  it("blocks missing predecessor", async () => {
    const { db, tx } = createDb({ predecessor: null });
    const { service } = createService(db);

    await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
      code: "PREDECESSOR_AGREEMENT_NOT_FOUND",
    });
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
  });

  it("blocks chain corruption", async () => {
    const { db, tx } = createDb({ predecessor: { renewed_to_agreement_id: "other-agreement" } });
    const { service } = createService(db);

    await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
      code: "INVALID_RENEWAL_CHAIN",
    });
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
  });

  it("blocks signing when renewal lifecycle metadata is incomplete", async () => {
    const { db, tx, records } = createDb({ renewal: { agreement_end_date: null } as any });
    const { service, pdfGenerator, activityLog } = createService(db);

    await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
      code: "AGREEMENT_LIFECYCLE_INCOMPLETE",
      status: 409,
      details: expect.objectContaining({
        agreementId: "agreement-2",
        missingFields: expect.arrayContaining(["agreement_end_date"]),
      }),
    });
    expect(records.get("agreement-1").status).toBe("SIGNED");
    expect(records.get("agreement-2").status).toBe("DRAFT");
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
    expect(pdfGenerator.generateAndUploadPdf).not.toHaveBeenCalled();
    expect(activityLog.log).not.toHaveBeenCalled();
  });

  it("blocks active move-out without status mutations", async () => {
    const { db, tx, records } = createDb({ activeMoveOut: { id: "move-1", status: "REQUESTED" } });
    const { service } = createService(db);

    await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
      code: "MOVE_OUT_IN_PROGRESS",
      details: expect.objectContaining({ moveOutRequestId: "move-1" }),
    });
    expect(records.get("agreement-1").status).toBe("SIGNED");
    expect(records.get("agreement-2").status).toBe("DRAFT");
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
  });

  it("blocks signing when an unpaid security deposit obligation exists for the renewal agreement", async () => {
    const { db, tx, records } = createDb({
      unpaidDeposit: { id: "deposit-ob-1", agreement_id: "agreement-2", amount: 4000, status: "PENDING" },
    });
    const { service } = createService(db);

    await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
      code: "SECURITY_DEPOSIT_UNPAID",
      status: 409,
      details: expect.objectContaining({ obligationId: "deposit-ob-1", amount: 4000 }),
    });
    expect(records.get("agreement-1").status).toBe("SIGNED");
    expect(records.get("agreement-2").status).toBe("DRAFT");
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
  });

  it("allows signing when there is no unpaid security deposit obligation", async () => {
    const { db, records } = createDb({ unpaidDeposit: null });
    const { service } = createService(db);

    await service.signRenewalAgreement(validInput);

    expect(records.get("agreement-2").status).toBe("SIGNED");
  });

  it("keeps signing committed when PDF generation fails", async () => {
    const { db, records } = createDb();
    const pdfGenerator = { generateAndUploadPdf: vi.fn().mockRejectedValue(new Error("storage down")) };
    const { service, activityLog } = createService(db, pdfGenerator);

    const result = await service.signRenewalAgreement(validInput);

    expect(records.get("agreement-1").status).toBe("RENEWED");
    expect(records.get("agreement-2").status).toBe("SIGNED");
    expect(records.get("agreement-2").pdf_url).toBeNull();
    expect(result).toMatchObject({
      pdfGenerated: false,
      pdfUrl: null,
      pdfError: "storage down",
    });
    expect(activityLog.log).toHaveBeenCalledWith(
      "AGREEMENT_RENEWED",
      "owner-1",
      expect.objectContaining({ pdf_generated: false, pdf_error: "storage down" }),
      "tenant-1"
    );
  });

  it("does not touch financial records", async () => {
    const { db, tx } = createDb();
    const { service } = createService(db);

    await service.signRenewalAgreement(validInput);

    expect(tx.payments.create).not.toHaveBeenCalled();
    expect(tx.payments.update).not.toHaveBeenCalled();
    expect(tx.payments.updateMany).not.toHaveBeenCalled();
    expect(tx.rent_obligations.create).not.toHaveBeenCalled();
    expect(tx.rent_obligations.createMany).not.toHaveBeenCalled();
    expect(tx.rent_obligations.update).not.toHaveBeenCalled();
    expect(tx.rent_obligations.updateMany).not.toHaveBeenCalled();
    expect(tx.tenant_financial_ledger.create).not.toHaveBeenCalled();
    expect(tx.tenant_financial_ledger.update).not.toHaveBeenCalled();
    expect(tx.tenant_financial_ledger.updateMany).not.toHaveBeenCalled();
    expect(tx.tenant_billing_plans.create).not.toHaveBeenCalled();
    expect(tx.tenant_billing_plans.update).not.toHaveBeenCalled();
    expect(tx.tenant_billing_plans.updateMany).not.toHaveBeenCalled();
  });

  it("does not touch room allocation or move-out records", async () => {
    const { db, tx } = createDb();
    const { service } = createService(db);

    await service.signRenewalAgreement(validInput);

    expect(tx.roomAllocation.create).not.toHaveBeenCalled();
    expect(tx.roomAllocation.update).not.toHaveBeenCalled();
    expect(tx.roomAllocation.updateMany).not.toHaveBeenCalled();
    expect(tx.move_out_requests.create).not.toHaveBeenCalled();
    expect(tx.move_out_requests.update).not.toHaveBeenCalled();
    expect(tx.move_out_requests.updateMany).not.toHaveBeenCalled();
  });

  it("syncs the tenant's active contract fields, matching what cron activation already does", async () => {
    const { db, tx } = createDb();
    const { service } = createService(db);

    await service.signRenewalAgreement(validInput);

    expect(tx.tenants.update).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      data: {
        monthly_rent: 8500,
        security_deposit: 10000,
        maintenance_charge: 1400,
        maintenance_type: "ONE_TIME",
      },
    });
    expect(tx.tenants.updateMany).not.toHaveBeenCalled();
  });

  it("records the timeline actor as OWNER when signedBy is not TENANT", async () => {
    const { db, tx } = createDb();
    const { service } = createService(db);

    await service.signRenewalAgreement({ ...validInput, signedBy: "OWNER" });

    expect(registerEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: "RENEWAL_ACTIVATED", actorType: "OWNER" })
    );
  });

  it("uses structured signing errors", () => {
    const error = new AgreementRenewalSigningError("INVALID_RENEWAL_CHAIN", "Bad chain", {
      renewalAgreementId: "agreement-2",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("INVALID_RENEWAL_CHAIN");
    expect(error.status).toBe(409);
    expect(error.details).toEqual({ renewalAgreementId: "agreement-2" });
  });
});
