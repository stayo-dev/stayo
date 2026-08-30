import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgreementLifecycleRecoveryError,
  AgreementLifecycleRecoveryService,
} from "@/src/services/tenants/agreement-lifecycle-recovery-service";

const completeSnapshot: any = {
  joining_date: "2026-06-14",
  monthly_rent: 8500,
  advance_deposit: 10000,
  maintenance_charge: 1400,
  maintenance_type: "ONE_TIME",
  payment_frequency: "MONTHLY",
};

const legacyAgreement: any = {
  id: "agreement-1",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  template_id: "template-1",
  status: "SIGNED",
  content_snapshot: completeSnapshot,
  generated_at: new Date("2026-06-15T00:00:00.000Z"),
  agreement_start_date: null,
  agreement_end_date: null,
  agreement_duration_months: null,
  contract_rent: null,
  contract_security_deposit: null,
  contract_maintenance: null,
  contract_maintenance_type: null,
  contract_payment_frequency: null,
  tenant: {
    id: "tenant-1",
    joined_on: new Date("2026-06-13T00:00:00.000Z"),
    profiles: { name: "Tenant One" },
  },
  hostel: {
    id: "hostel-1",
    name: "Sunrise Residency",
    owner_id: "owner-1",
  },
};

function createDb(recordsInput = [legacyAgreement]) {
  const records = new Map(recordsInput.map((record: any) => [record.id, { ...record }]));
  const db = {
    agreement: {
      findMany: vi.fn(async () => Array.from(records.values()).map((record) => ({ ...record }))),
      findUnique: vi.fn(async ({ where }: any) => {
        const record = records.get(where.id);
        return record ? { ...record } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const record = records.get(where.id);
        if (!record) throw new Error("missing test record");
        const updated = { ...record, ...data };
        records.set(where.id, updated);
        return { ...updated };
      }),
    },
    tenants: { update: vi.fn(), updateMany: vi.fn() },
    roomAllocation: { update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    rent_obligations: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    payments: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tenant_financial_ledger: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    move_out_requests: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };

  return { db, records };
}

describe("AgreementLifecycleRecoveryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects pending and completed legacy agreement lifecycle recovery", async () => {
    const completedAgreement = {
      ...legacyAgreement,
      id: "agreement-2",
      agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
      agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
      agreement_duration_months: 12,
    };
    const { db } = createDb([legacyAgreement, completedAgreement]);
    const service = new AgreementLifecycleRecoveryService(db as any);

    const report = await service.getRecoveryReport({ ownerId: "owner-1" });

    expect(report).toMatchObject({
      total: 2,
      completed: 1,
      pending: 1,
    });
    expect(report.agreements[0]).toMatchObject({
      id: "agreement-1",
      current_status: "SIGNED",
      lifecycle_complete: false,
      recommended_start_date: new Date("2026-06-14T00:00:00.000Z"),
      snapshot_values: completeSnapshot,
    });
  });

  it("returns lifecycle recovery completion readiness summary", async () => {
    const completedAgreement = {
      ...legacyAgreement,
      id: "agreement-2",
      agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
      agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
      agreement_duration_months: 12,
    };
    const { db } = createDb([legacyAgreement, completedAgreement]);
    const service = new AgreementLifecycleRecoveryService(db as any);

    const completion = await service.getRecoveryCompletion({ ownerId: "owner-1" });

    expect(completion).toEqual({
      total: 2,
      completed: 1,
      pending: 1,
      coveragePercent: 50,
      r4Ready: false,
    });
  });

  it("completes lifecycle dates and contract fields from content_snapshot", async () => {
    const { db, records } = createDb();
    const service = new AgreementLifecycleRecoveryService(db as any);

    const result = await service.recoverAgreementLifecycle("agreement-1", {
      agreement_start_date: "2026-06-14",
      agreement_end_date: "2027-06-14",
      agreement_duration_months: 12,
    });

    expect(result).toMatchObject({
      id: "agreement-1",
      lifecycle_complete: true,
      agreement_duration_months: 12,
    });
    expect(records.get("agreement-1")).toMatchObject({
      status: "SIGNED",
      agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
      agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 10000,
      contract_maintenance: 1400,
      contract_maintenance_type: "ONE_TIME",
      contract_payment_frequency: "MONTHLY",
    });
  });

  it("rejects missing and invalid lifecycle input", async () => {
    const { db } = createDb();
    const service = new AgreementLifecycleRecoveryService(db as any);

    await expect(service.recoverAgreementLifecycle("agreement-1", {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
      details: { field: "agreement_start_date" },
    });
    await expect(service.recoverAgreementLifecycle("agreement-1", {
      agreement_start_date: "2026-06-14",
      agreement_end_date: "2026-06-14",
      agreement_duration_months: 12,
    })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({
        agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
        agreement_end_date: new Date("2026-06-14T00:00:00.000Z"),
      }),
    });
  });

  it("rejects recovery when contract snapshot values are missing", async () => {
    const { db } = createDb([{ ...legacyAgreement, content_snapshot: { joining_date: "2026-06-14" } }]);
    const service = new AgreementLifecycleRecoveryService(db as any);

    await expect(service.recoverAgreementLifecycle("agreement-1", {
      agreement_start_date: "2026-06-14",
      agreement_end_date: "2027-06-14",
      agreement_duration_months: 12,
    })).rejects.toMatchObject({
      code: "CONTRACT_SNAPSHOT_INCOMPLETE",
      status: 409,
      details: expect.objectContaining({
        missingFields: expect.arrayContaining(["contract_rent", "contract_payment_frequency"]),
      }),
    });
  });

  it("allows idempotent re-save of recovered lifecycle data", async () => {
    const recovered = {
      ...legacyAgreement,
      agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
      agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
      agreement_duration_months: 12,
      contract_rent: 8500,
      contract_security_deposit: 10000,
      contract_maintenance: 1400,
      contract_maintenance_type: "ONE_TIME",
      contract_payment_frequency: "MONTHLY",
    };
    const { db, records } = createDb([recovered]);
    const service = new AgreementLifecycleRecoveryService(db as any);

    await service.recoverAgreementLifecycle("agreement-1", {
      agreement_start_date: "2026-06-14",
      agreement_end_date: "2027-06-14",
      agreement_duration_months: 12,
    });
    await service.recoverAgreementLifecycle("agreement-1", {
      agreement_start_date: "2026-06-14",
      agreement_end_date: "2027-06-14",
      agreement_duration_months: 12,
    });

    expect(db.agreement.update).toHaveBeenCalledTimes(2);
    expect(records.get("agreement-1")).toMatchObject({
      agreement_duration_months: 12,
      contract_rent: 8500,
    });
  });

  it("does not touch financial, occupancy, move-out, tenant, status, or PDF records", async () => {
    const { db, records } = createDb();
    const service = new AgreementLifecycleRecoveryService(db as any);

    await service.recoverAgreementLifecycle("agreement-1", {
      agreement_start_date: "2026-06-14",
      agreement_end_date: "2027-06-14",
      agreement_duration_months: 12,
    });

    expect(records.get("agreement-1").status).toBe("SIGNED");
    expect(records.get("agreement-1").pdf_url).toBeUndefined();
    expect(db.tenants.update).not.toHaveBeenCalled();
    expect(db.tenants.updateMany).not.toHaveBeenCalled();
    expect(db.roomAllocation.create).not.toHaveBeenCalled();
    expect(db.roomAllocation.update).not.toHaveBeenCalled();
    expect(db.roomAllocation.updateMany).not.toHaveBeenCalled();
    expect(db.rent_obligations.create).not.toHaveBeenCalled();
    expect(db.rent_obligations.update).not.toHaveBeenCalled();
    expect(db.rent_obligations.updateMany).not.toHaveBeenCalled();
    expect(db.payments.create).not.toHaveBeenCalled();
    expect(db.payments.update).not.toHaveBeenCalled();
    expect(db.payments.updateMany).not.toHaveBeenCalled();
    expect(db.tenant_financial_ledger.create).not.toHaveBeenCalled();
    expect(db.tenant_financial_ledger.update).not.toHaveBeenCalled();
    expect(db.tenant_financial_ledger.updateMany).not.toHaveBeenCalled();
    expect(db.move_out_requests.create).not.toHaveBeenCalled();
    expect(db.move_out_requests.update).not.toHaveBeenCalled();
    expect(db.move_out_requests.updateMany).not.toHaveBeenCalled();
  });

  it("uses structured recovery errors", () => {
    const error = new AgreementLifecycleRecoveryError("VALIDATION_ERROR", "Bad input", 400, { field: "date" });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ field: "date" });
  });
});
