import { beforeEach, describe, expect, it, vi } from "vitest";
import { reservationStatusService } from "@/src/services/tenants/reservation-status-service";
import { activationFinancialStatusService } from "@/src/services/tenants/activation-financial-status-service";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    tenants: {
      findUnique: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

vi.mock("@/src/services/tenants/activation-financial-status-service", () => ({
  activationFinancialStatusService: {
    getActivationFinancialStatus: vi.fn(),
  },
}));

const mockFinancialStatus = {
  requiredDeposit: 10000,
  paidDeposit: 0,
  depositOutstanding: 10000,
  depositActivationThreshold: 10000,
  depositThresholdOutstanding: 10000,
  isDepositFullyPaid: false,
  requiredMaintenance: 1000,
  paidMaintenance: 0,
  maintenanceOutstanding: 1000,
  isDepositCleared: false,
  isMaintenanceCleared: false,
  isFinanciallyReady: false,
};

describe("ReservationStatusService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns MOVE_IN_READY status when financial readiness is fully met", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      reservation_policy: "FULL_DEPOSIT",
      minimum_reservation_deposit: 0,
    } as any);

    vi.mocked(activationFinancialStatusService.getActivationFinancialStatus).mockResolvedValue({
      ...mockFinancialStatus,
      paidDeposit: 10000,
      depositOutstanding: 0,
      paidMaintenance: 1000,
      maintenanceOutstanding: 0,
      isDepositCleared: true,
      isMaintenanceCleared: true,
      isFinanciallyReady: true,
    });

    const status = await reservationStatusService.getReservationStatus("tenant-1");
    expect(status.status).toBe("MOVE_IN_READY");
    expect(status.threshold).toBe(10000);
  });

  it("returns RESERVED when policy is FULL_DEPOSIT, deposit is fully paid, and maintenance is fully paid", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      reservation_policy: "FULL_DEPOSIT",
      minimum_reservation_deposit: 0,
    } as any);

    vi.mocked(activationFinancialStatusService.getActivationFinancialStatus).mockResolvedValue({
      ...mockFinancialStatus,
      paidDeposit: 10000,
      depositOutstanding: 0,
      paidMaintenance: 1000,
      maintenanceOutstanding: 0,
      isDepositCleared: true,
      isMaintenanceCleared: true,
      isFinanciallyReady: false,
    });

    const status = await reservationStatusService.getReservationStatus("tenant-1");
    expect(status.status).toBe("RESERVED");
  });

  it("returns RESERVED when policy is PARTIAL_DEPOSIT, paid deposit >= minimum_reservation_deposit, and maintenance is paid", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      reservation_policy: "PARTIAL_DEPOSIT",
      minimum_reservation_deposit: 3000,
    } as any);

    vi.mocked(activationFinancialStatusService.getActivationFinancialStatus).mockResolvedValue({
      ...mockFinancialStatus,
      depositActivationThreshold: 3000,
      paidDeposit: 4000,
      depositOutstanding: 6000,
      paidMaintenance: 1000,
      maintenanceOutstanding: 0,
      isDepositCleared: false,
      isMaintenanceCleared: true,
      isFinanciallyReady: false,
    });

    const status = await reservationStatusService.getReservationStatus("tenant-1");
    expect(status.status).toBe("RESERVED");
    expect(status.threshold).toBe(3000);
  });

  it("returns PAYMENT_PENDING when paid deposit < threshold", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      reservation_policy: "PARTIAL_DEPOSIT",
      minimum_reservation_deposit: 3000,
    } as any);

    vi.mocked(activationFinancialStatusService.getActivationFinancialStatus).mockResolvedValue({
      ...mockFinancialStatus,
      depositActivationThreshold: 3000,
      paidDeposit: 2000,
      depositOutstanding: 8000,
      paidMaintenance: 1000,
      maintenanceOutstanding: 0,
      isDepositCleared: false,
      isMaintenanceCleared: true,
      isFinanciallyReady: false,
    });

    const status = await reservationStatusService.getReservationStatus("tenant-1");
    expect(status.status).toBe("PAYMENT_PENDING");
  });

  it("returns PAYMENT_PENDING when maintenance is not fully paid, even if deposit is cleared", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue({
      id: "tenant-1",
      reservation_policy: "FULL_DEPOSIT",
      minimum_reservation_deposit: 0,
    } as any);

    vi.mocked(activationFinancialStatusService.getActivationFinancialStatus).mockResolvedValue({
      ...mockFinancialStatus,
      paidDeposit: 10000,
      depositOutstanding: 0,
      paidMaintenance: 0,
      maintenanceOutstanding: 1000,
      isDepositCleared: true,
      isMaintenanceCleared: false,
      isFinanciallyReady: false,
    });

    const status = await reservationStatusService.getReservationStatus("tenant-1");
    expect(status.status).toBe("PAYMENT_PENDING");
  });

  it("throws not found when tenant is missing", async () => {
    vi.mocked(prisma.tenants.findUnique).mockResolvedValue(null);

    await expect(reservationStatusService.getReservationStatus("missing")).rejects.toThrow("NOT_FOUND: Tenant not found");
  });
});
