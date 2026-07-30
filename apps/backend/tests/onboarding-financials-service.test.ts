import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingFinancialsService } from "@/src/services/payments/onboarding-financials-service";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    tenants: {
      findUnique: vi.fn(),
    },
    rent_obligations: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("OnboardingFinancialsService", () => {
  let service: OnboardingFinancialsService;
  const joiningDate = new Date("2026-07-10T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OnboardingFinancialsService();
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      owner_id: "owner-1",
      hostel_id: "hostel-1",
      status: "INVITED",
      security_deposit: 0,
    } as any);
    vi.mocked(prisma.rent_obligations.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.rent_obligations.create).mockResolvedValue({ id: "obligation-1" } as any);
  });

  it("creates an onboarding maintenance obligation for an invited tenant", async () => {
    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate,
      maintenanceCharge: 1500,
      maintenanceType: "MONTHLY",
    });

    expect(result).toEqual({ createdObligations: ["MAINTENANCE"], createdObligationIds: ["obligation-1"], skipped: false });
    expect(prisma.rent_obligations.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: "tenant-1",
        allocation_id: null,
        owner_id: "owner-1",
        hostel_id: "hostel-1",
        amount: 1500,
        total_amount: 1500,
        due_date: joiningDate,
        status: "PENDING",
        obligation_type: "MAINTENANCE",
        installment_label: "Onboarding maintenance",
      }),
    });
  });

  it("does not create maintenance when maintenance_type is NONE", async () => {
    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate,
      maintenanceCharge: 1500,
      maintenanceType: "NONE",
    });

    expect(result).toEqual({
      createdObligations: [],
      createdObligationIds: [],
      skipped: true,
      reason: "NO_FINANCIALS_REQUIRED",
    });
    expect(prisma.rent_obligations.create).not.toHaveBeenCalled();
  });

  it("is idempotent when an onboarding maintenance obligation already exists", async () => {
    vi.mocked(prisma.rent_obligations.findFirst).mockResolvedValue({ id: "existing-obligation" } as any);

    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate,
      maintenanceCharge: 1500,
      maintenanceType: "ONE_TIME",
    });

    expect(result).toEqual({
      createdObligations: [],
      createdObligationIds: [],
      skipped: true,
      reason: "OBLIGATIONS_EXIST",
    });
    expect(prisma.rent_obligations.create).not.toHaveBeenCalled();
  });

  it("creates deposit obligations when security_deposit is configured", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      owner_id: "owner-1",
      hostel_id: "hostel-1",
      status: "INVITED",
      security_deposit: 5000,
    } as any);

    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
    });

    expect(result).toEqual({ createdObligations: ["SECURITY_DEPOSIT"], createdObligationIds: ["obligation-1"], skipped: false });
    expect(prisma.rent_obligations.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: "tenant-1",
        allocation_id: null,
        owner_id: "owner-1",
        hostel_id: "hostel-1",
        amount: 5000,
        total_amount: 5000,
        due_date: joiningDate,
        status: "PENDING",
        obligation_type: "SECURITY_DEPOSIT",
        installment_label: "Security Deposit",
      }),
    });
  });

  it("leaves existing non-invited tenants unchanged", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      owner_id: "owner-1",
      hostel_id: "hostel-1",
      status: "ACTIVE",
    } as any);

    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate,
      maintenanceCharge: 1500,
      maintenanceType: "MONTHLY",
    });

    expect(result).toEqual({
      createdObligations: [],
      createdObligationIds: [],
      skipped: true,
      reason: "TENANT_NOT_INVITED",
    });
    expect(prisma.rent_obligations.create).not.toHaveBeenCalled();
  });
});
