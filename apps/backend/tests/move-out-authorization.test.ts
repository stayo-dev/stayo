import { beforeEach, describe, expect, it, vi } from "vitest";

const requestA = {
  id: "req-a",
  tenant_id: "tenant-a",
  owner_id: "owner-a",
  hostel_id: "hostel-a",
  status: "REQUESTED",
  reason: "OTHER",
  reason_text: null,
  planned_exit_date: new Date("2026-07-01"),
  tenant: { profile_id: "profile-a" },
};

const requestB = {
  id: "req-b",
  tenant_id: "tenant-b",
  owner_id: "owner-b",
  hostel_id: "hostel-b",
  status: "REQUESTED",
  reason: "OTHER",
  reason_text: null,
  planned_exit_date: new Date("2026-07-01"),
  tenant: { profile_id: "profile-b" },
};

const requests = new Map([
  [requestA.id, requestA],
  [requestB.id, requestB],
]);

const disputeB = {
  id: "dispute-b",
  request_id: requestB.id,
  request: requestB,
};

const prismaMock = {
  move_out_requests: {
    findUnique: vi.fn(async ({ where }: any) => requests.get(where.id) ?? null),
    update: vi.fn(),
  },
  tenants: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id === "tenant-a") {
        return { id: "tenant-a", profile_id: "profile-a", owner_id: "owner-a", hostel_id: "hostel-a", status: "ACTIVE", year_of_study: 2 };
      }
      if (where.id === "tenant-b") {
        return { id: "tenant-b", profile_id: "profile-b", owner_id: "owner-b", hostel_id: "hostel-b", status: "ACTIVE", year_of_study: 2 };
      }
      return null;
    }),
    update: vi.fn(),
  },
  exit_disputes: {
    findUnique: vi.fn(async ({ where }: any) => (where.id === disputeB.id ? disputeB : null)),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  move_out_inspections: {
    upsert: vi.fn(),
  },
  move_out_inspection_items: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  exit_feedbacks: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  profile: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (fn: any) => fn(prismaMock)),
};

const mockGetReservationStatus = vi.fn(async (tenantId: string) => ({ status: "RESERVED" }));
vi.mock("../src/services/tenants/reservation-status-service", () => ({
  reservationStatusService: {
    getReservationStatus: mockGetReservationStatus,
  },
}));

vi.mock("../lib/db", () => ({ prisma: prismaMock }));
vi.mock("../lib/services/move-out-notifications", () => ({ notifyMoveOutTransition: vi.fn() }));
vi.mock("../src/services/payments/financial-service", () => ({ financialService: {} }));
vi.mock("../src/services/payments/tenant-financial-ledger-service", () => ({ tenantFinancialLedgerService: {} }));

describe("MoveOutService service-layer authorization", () => {
  let moveOutService: import("../lib/services/move-out-service").MoveOutService;

  const tenantA = { id: "profile-a", role: "TENANT", tenantId: "tenant-a" };
  const ownerA = { id: "owner-a", role: "OWNER", ownerId: "owner-a" };

  beforeEach(async () => {
    vi.clearAllMocks();
    moveOutService = (await import("../lib/services/move-out-service")).moveOutService;
  });

  it("blocks Tenant A from cancelling Tenant B's move-out request", async () => {
    await expect(moveOutService.cancelRequest("req-b", tenantA, "malicious cancel")).rejects.toThrow("FORBIDDEN:");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.move_out_requests.update).not.toHaveBeenCalled();
  });

  it("blocks Tenant A from raising a dispute on Tenant B's move-out request", async () => {
    await expect(
      moveOutService.raiseDispute({
        requestId: "req-b",
        actor: tenantA,
        disputeType: "DEDUCTION",
        description: "malicious dispute",
      }),
    ).rejects.toThrow("FORBIDDEN:");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.exit_disputes.create).not.toHaveBeenCalled();
  });

  it("blocks Tenant A from resolving Tenant B's dispute", async () => {
    await expect(moveOutService.resolveDispute("dispute-b", tenantA, "malicious resolution")).rejects.toThrow("FORBIDDEN:");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.exit_disputes.update).not.toHaveBeenCalled();
  });

  it("blocks Owner A from mutating Owner B's move-out request", async () => {
    await expect(moveOutService.cancelRequest("req-b", ownerA, "cross-owner cancel")).rejects.toThrow("FORBIDDEN:");
    await expect(moveOutService.rejectRequest("req-b", ownerA, "cross-owner reject")).rejects.toThrow("FORBIDDEN:");
    await expect(moveOutService.approveSettlement("req-b", ownerA)).rejects.toThrow("FORBIDDEN:");
    await expect(moveOutService.vacate("req-b", ownerA)).rejects.toThrow("FORBIDDEN:");
    await expect(moveOutService.confirmPaymentAndComplete({ requestId: "req-b", actor: ownerA })).rejects.toThrow("FORBIDDEN:");
    await expect(moveOutService.submitInspection({
      requestId: "req-b",
      actor: ownerA,
      inspectedBy: ownerA.id,
      roomCondition: "GOOD",
      cleaningStatus: "CLEAN",
    })).rejects.toThrow("FORBIDDEN:");
    await expect(moveOutService.submitFeedback({ requestId: "req-b", actor: ownerA })).rejects.toThrow("FORBIDDEN:");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.move_out_requests.update).not.toHaveBeenCalled();
    expect(prismaMock.move_out_inspections.upsert).not.toHaveBeenCalled();
    expect(prismaMock.exit_feedbacks.create).not.toHaveBeenCalled();
  });

  it("blocks Owner A from creating a move-out request for Owner B's tenant", async () => {
    await expect(moveOutService.createRequest({
      tenantId: "tenant-b",
      hostelId: "hostel-b",
      ownerId: "owner-b",
      initiatedBy: ownerA.id,
      initiatedByRole: "OWNER",
      actor: ownerA,
      reason: "OTHER" as any,
      plannedExitDate: "2026-07-01",
    })).rejects.toThrow("FORBIDDEN:");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("blocks Tenant A from creating a move-out request when reservation status is PAYMENT_PENDING", async () => {
    mockGetReservationStatus.mockResolvedValueOnce({ status: "PAYMENT_PENDING" });

    await expect(moveOutService.createRequest({
      tenantId: "tenant-a",
      hostelId: "hostel-a",
      ownerId: "owner-a",
      initiatedBy: "profile-a",
      initiatedByRole: "TENANT",
      actor: tenantA,
      reason: "OTHER" as any,
      plannedExitDate: "2026-07-01",
    })).rejects.toThrow("FORBIDDEN: Move-out requests are not allowed");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
