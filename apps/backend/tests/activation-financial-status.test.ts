import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivationFinancialStatusService } from "@/src/services/tenants/activation-financial-status-service";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    tenants: {
      findUnique: vi.fn(),
    },
    tenant_financial_ledger: {
      aggregate: vi.fn().mockImplementation((args) => {
        if (args?.where?.reference_type === "PAYMENT") {
          return Promise.resolve({ _sum: { amount: 0 } });
        }
        return Promise.resolve({ _sum: { amount: 0 } });
      }),
    },
    rent_obligations: {
      findMany: vi.fn(),
    },
    payments: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount_paid: 0 } }),
    },
  };
  return { prisma: mockPrisma };
});

describe("ActivationFinancialStatusService", () => {
  let service: ActivationFinancialStatusService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ActivationFinancialStatusService();
  });

  it("uses tenant.advance_deposit and CREDIT/DEPOSIT ledger entries for deposit readiness", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      security_deposit: 10000,
      maintenance_charge: 1500,
      maintenance_type: "ONE_TIME",
    } as any);
    vi.mocked(prisma.tenant_financial_ledger.aggregate).mockResolvedValue({ _sum: { amount: 7000 } } as any);
    vi.mocked(prisma.rent_obligations.findMany).mockResolvedValue([
      { payments: [{ amount_paid: 1500 }] },
    ] as any);

    const status = await service.getActivationFinancialStatus("tenant-1");

    expect(prisma.tenant_financial_ledger.aggregate).toHaveBeenCalledWith({
      where: { tenant_id: "tenant-1", type: "CREDIT", reason: "SECURITY_DEPOSIT_COLLECTED" },
      _sum: { amount: true },
    });
    expect(status).toEqual({
      requiredDeposit: 10000,
      paidDeposit: 7000,
      depositOutstanding: 3000,
      requiredMaintenance: 1500,
      paidMaintenance: 1500,
      maintenanceOutstanding: 0,
      isDepositFullyPaid: false,
      isMaintenanceCleared: true,
      isFinanciallyReady: false,
    });
  });

  it("treats a part-paid deposit as still outstanding", async () => {
    // There is no longer a "minimum to reserve a bed": partial deposits used to
    // make a tenant activation-ready at a threshold below the full amount.
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      security_deposit: 10000,
      maintenance_charge: 1500,
      maintenance_type: "ONE_TIME",
    } as any);
    vi.mocked(prisma.tenant_financial_ledger.aggregate).mockResolvedValue({ _sum: { amount: 4000 } } as any);
    vi.mocked(prisma.rent_obligations.findMany).mockResolvedValue([
      { payments: [{ amount_paid: 1500 }] },
    ] as any);

    const status = await service.getActivationFinancialStatus("tenant-1");

    expect(status.requiredDeposit).toBe(10000);
    expect(status.paidDeposit).toBe(4000);
    expect(status.depositOutstanding).toBe(6000);
    expect(status.isDepositFullyPaid).toBe(false);
    expect(status.isFinanciallyReady).toBe(false);
  });

  it("does not count TOPUP/future rent credit toward deposit readiness", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      security_deposit: 10000,
      maintenance_charge: 0,
      maintenance_type: "NONE",
    } as any);
    vi.mocked(prisma.tenant_financial_ledger.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any);
    vi.mocked(prisma.rent_obligations.findMany).mockResolvedValue([] as any);

    const status = await service.getActivationFinancialStatus("tenant-1");

    expect(status.paidDeposit).toBe(0);
    expect(status.depositOutstanding).toBe(10000);
    expect(status.isFinanciallyReady).toBe(false);
  });

  it("counts maintenance payments only from existing non-superseded MAINTENANCE obligations", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      security_deposit: 0,
      maintenance_charge: 2500,
      maintenance_type: "MONTHLY",
    } as any);
    vi.mocked(prisma.tenant_financial_ledger.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any);
    vi.mocked(prisma.rent_obligations.findMany).mockResolvedValue([
      { payments: [{ amount_paid: 1000 }, { amount_paid: 500 }] },
    ] as any);

    const status = await service.getActivationFinancialStatus("tenant-1");

    expect(prisma.rent_obligations.findMany).toHaveBeenCalledWith({
      where: { tenant_id: "tenant-1", obligation_type: "MAINTENANCE", is_superseded: false },
      select: { payments: { select: { amount_paid: true } } },
    });
    expect(status.requiredMaintenance).toBe(2500);
    expect(status.paidMaintenance).toBe(1500);
    expect(status.maintenanceOutstanding).toBe(1000);
    expect(status.isMaintenanceCleared).toBe(false);
  });

  it("exposes modern invitation maintenance gap safely when no maintenance obligation exists", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      security_deposit: 0,
      maintenance_charge: 1200,
      maintenance_type: "ONE_TIME",
    } as any);
    vi.mocked(prisma.tenant_financial_ledger.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any);
    vi.mocked(prisma.rent_obligations.findMany).mockResolvedValue([] as any);

    const status = await service.getActivationFinancialStatus("tenant-1");

    expect(status.requiredMaintenance).toBe(1200);
    expect(status.paidMaintenance).toBe(0);
    expect(status.maintenanceOutstanding).toBe(1200);
    expect(status.isFinanciallyReady).toBe(false);
  });

  it("returns ready when deposit and maintenance are both cleared", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      security_deposit: 10000,
      maintenance_charge: 1500,
      maintenance_type: "ONE_TIME",
    } as any);
    vi.mocked(prisma.tenant_financial_ledger.aggregate).mockResolvedValue({ _sum: { amount: 12000 } } as any);
    vi.mocked(prisma.rent_obligations.findMany).mockResolvedValue([
      { payments: [{ amount_paid: 1500 }] },
    ] as any);

    const status = await service.getActivationFinancialStatus("tenant-1");

    expect(status.depositOutstanding).toBe(0);
    expect(status.maintenanceOutstanding).toBe(0);
    expect(status.isFinanciallyReady).toBe(true);
  });

  it("fails clearly when tenant is missing", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue(null);

    await expect(service.getActivationFinancialStatus("missing")).rejects.toThrow("NOT_FOUND: Tenant not found");
  });
});
