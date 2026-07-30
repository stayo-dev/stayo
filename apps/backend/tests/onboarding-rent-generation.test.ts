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

describe("P0: Current-Month Rent Generation at Invitation", () => {
  let service: OnboardingFinancialsService;

  // Use a past joining date (yesterday) to trigger rent generation
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  // Use a future joining date to confirm rent is NOT generated
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const baseTenant = {
    id: "tenant-1",
    owner_id: "owner-1",
    hostel_id: "hostel-1",
    status: "INVITED",
    security_deposit: 16800,
    monthly_rent: 8400,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OnboardingFinancialsService();
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue(baseTenant as any);
    vi.mocked(prisma.rent_obligations.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.rent_obligations.create).mockResolvedValue({ id: "obligation-new" } as any);
  });

  it("creates RENT obligation when joining_date <= today", async () => {
    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate: yesterday,
      monthlyRent: 8400,
      maintenanceCharge: 1500,
      maintenanceType: "ONE_TIME",
    });

    expect(result.createdObligations).toContain("RENT");
    expect(result.createdObligations).toContain("SECURITY_DEPOSIT");
    expect(result.createdObligations).toContain("MAINTENANCE");
    expect(result.skipped).toBe(false);

    // Verify RENT obligation was created with correct amount
    const rentCall = vi.mocked(prisma.rent_obligations.create).mock.calls.find(
      (call) => call[0].data.obligation_type === "RENT"
    );
    expect(rentCall).toBeDefined();
    expect(rentCall![0].data.amount).toBe(8400);
    expect(rentCall![0].data.obligation_type).toBe("RENT");
    expect(rentCall![0].data.status).toBe("PENDING");
  });

  it("creates RENT obligation when joining_date is exactly today", async () => {
    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate: today,
      monthlyRent: 8400,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
    });

    expect(result.createdObligations).toContain("RENT");
    expect(result.createdObligations).toContain("SECURITY_DEPOSIT");
  });

  it("does NOT create RENT when joining_date is in the future", async () => {
    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate: nextMonth,
      monthlyRent: 8400,
      maintenanceCharge: 1500,
      maintenanceType: "ONE_TIME",
    });

    expect(result.createdObligations).not.toContain("RENT");
    expect(result.createdObligations).toContain("SECURITY_DEPOSIT");
    expect(result.createdObligations).toContain("MAINTENANCE");

    const rentCall = vi.mocked(prisma.rent_obligations.create).mock.calls.find(
      (call) => call[0].data.obligation_type === "RENT"
    );
    expect(rentCall).toBeUndefined();
  });

  it("is idempotent — does not duplicate RENT if one already exists", async () => {
    // First call for RENT findFirst returns existing obligation
    vi.mocked(prisma.rent_obligations.findFirst).mockImplementation(async (args: any) => {
      if (args.where.obligation_type === "RENT") {
        return { id: "existing-rent" } as any;
      }
      return null;
    });

    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate: yesterday,
      monthlyRent: 8400,
      maintenanceCharge: 1500,
      maintenanceType: "ONE_TIME",
    });

    // Should still create MAINTENANCE and SECURITY_DEPOSIT but NOT RENT
    expect(result.createdObligations).not.toContain("RENT");
    expect(result.createdObligations).toContain("MAINTENANCE");
    expect(result.createdObligations).toContain("SECURITY_DEPOSIT");

    const rentCreate = vi.mocked(prisma.rent_obligations.create).mock.calls.find(
      (call) => call[0].data.obligation_type === "RENT"
    );
    expect(rentCreate).toBeUndefined();
  });

  it("generates RENT only for current month, not future months", async () => {
    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate: yesterday,
      monthlyRent: 8400,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
    });

    // Only one RENT obligation should be created
    const rentCalls = vi.mocked(prisma.rent_obligations.create).mock.calls.filter(
      (call) => call[0].data.obligation_type === "RENT"
    );
    expect(rentCalls).toHaveLength(1);

    // Verify the rent_month is the 1st of the joining month
    const rentMonth = rentCalls[0][0].data.rent_month;
    expect(rentMonth.getUTCDate()).toBe(1);
    expect(rentMonth.getUTCMonth()).toBe(yesterday.getMonth());
    expect(rentMonth.getUTCFullYear()).toBe(yesterday.getFullYear());
  });

  it("uses monthlyRent parameter over tenant.monthly_rent when provided", async () => {
    const result = await service.initializeOnboardingFinancials(prisma as any, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate: yesterday,
      monthlyRent: 9500, // Override the tenant's 8400
      maintenanceCharge: 0,
      maintenanceType: "NONE",
    });

    expect(result.createdObligations).toContain("RENT");
    const rentCall = vi.mocked(prisma.rent_obligations.create).mock.calls.find(
      (call) => call[0].data.obligation_type === "RENT"
    );
    expect(rentCall![0].data.amount).toBe(9500);
  });
});
