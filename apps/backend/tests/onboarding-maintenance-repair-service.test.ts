import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingMaintenanceRepairService } from "@/src/services/payments/onboarding-maintenance-repair-service";

describe("OnboardingMaintenanceRepairService", () => {
  const candidateTenant = {
    id: "tenant-1",
    owner_id: "owner-1",
    hostel_id: "hostel-1",
    joined_on: new Date("2026-07-01T00:00:00.000Z"),
    billing_start_date: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    maintenance_charge: 1000,
    maintenance_type: "ONE_TIME",
  };

  let db: any;
  let financials: any;

  beforeEach(() => {
    db = {
      tenants: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (callback: any) => callback({ tx: true })),
    };
    financials = {
      initializeOnboardingFinancials: vi.fn(async () => ({
        createdObligations: ["MAINTENANCE"],
        createdObligationIds: [],
        skipped: false,
      })),
    };
  });

  it("finds only missing invited onboarding maintenance candidates", async () => {
    db.tenants.findMany.mockResolvedValue([candidateTenant]);
    const service = new OnboardingMaintenanceRepairService(db, financials);

    const candidates = await service.findMissingOnboardingMaintenanceCandidates();

    expect(db.tenants.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "INVITED",
        maintenance_charge: { gt: 0 },
        NOT: { maintenance_type: "NONE" },
        rent_obligations: {
          none: {
            obligation_type: "MAINTENANCE",
            is_superseded: false,
          },
        },
      }),
    }));
    expect(candidates).toEqual([
      {
        tenantId: "tenant-1",
        ownerId: "owner-1",
        hostelId: "hostel-1",
        joiningDate: candidateTenant.joined_on,
        maintenanceCharge: 1000,
        maintenanceType: "ONE_TIME",
      },
    ]);
  });

  it("dry-runs without creating obligations", async () => {
    db.tenants.findMany.mockResolvedValue([candidateTenant]);
    const service = new OnboardingMaintenanceRepairService(db, financials);

    const result = await service.repairMissingOnboardingMaintenance();

    expect(result).toMatchObject({
      dryRun: true,
      affectedBefore: 1,
      repaired: 0,
      stillMissing: 1,
      skipped: [],
    });
    expect(financials.initializeOnboardingFinancials).not.toHaveBeenCalled();
  });

  it("repairs by reusing OnboardingFinancialsService inside a transaction", async () => {
    db.tenants.findMany
      .mockResolvedValueOnce([candidateTenant])
      .mockResolvedValueOnce([]);
    const service = new OnboardingMaintenanceRepairService(db, financials);

    const result = await service.repairMissingOnboardingMaintenance({ dryRun: false });

    expect(financials.initializeOnboardingFinancials).toHaveBeenCalledWith({ tx: true }, {
      tenantId: "tenant-1",
      ownerId: "owner-1",
      hostelId: "hostel-1",
      joiningDate: candidateTenant.joined_on,
      maintenanceCharge: 1000,
      maintenanceType: "ONE_TIME",
    });
    expect(result).toMatchObject({
      dryRun: false,
      affectedBefore: 1,
      repaired: 1,
      stillMissing: 0,
      skipped: [],
    });
  });

  it("is idempotent when the second run has no candidates", async () => {
    db.tenants.findMany.mockResolvedValue([]);
    const service = new OnboardingMaintenanceRepairService(db, financials);

    const result = await service.repairMissingOnboardingMaintenance({ dryRun: false });

    expect(result).toMatchObject({
      dryRun: false,
      affectedBefore: 0,
      repaired: 0,
      stillMissing: 0,
    });
    expect(financials.initializeOnboardingFinancials).not.toHaveBeenCalled();
  });
});
