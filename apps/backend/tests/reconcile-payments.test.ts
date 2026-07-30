import { describe, expect, it, vi, beforeEach } from "vitest";
import { paymentService } from "@/src/services/payments/payment-service";
import { prisma } from "@/lib/db";

vi.mock("axios");
vi.mock("@/lib/db", () => {
  const mockDb = {
    $transaction: vi.fn().mockImplementation((cb) => cb(mockDb)),
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve([{ next_sequence: 1 }])),
    $executeRaw: vi.fn().mockImplementation(() => Promise.resolve(0)),
    paymentReconciliationRun: {
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: "run_123" })),
      update: vi.fn().mockImplementation(() => Promise.resolve({})),
    },
    paymentReconciliationItem: {
      create: vi.fn().mockImplementation(() => Promise.resolve({})),
    },
    paymentAttempt: {
      findMany: vi.fn(),
      update: vi.fn().mockImplementation(() => Promise.resolve({})),
      updateMany: vi.fn().mockImplementation(() => Promise.resolve({ count: 1 })),
    },
    paymentAttemptStatusEvent: {
      create: vi.fn(),
      aggregate: vi.fn().mockImplementation(() => Promise.resolve({ _max: { transition_sequence: 0 } })),
    },
    paymentProviderVerificationSnapshot: {
      create: vi.fn(),
    },
    payments: {
      findFirst: vi.fn(),
    },
  };

  return {
    prisma: mockDb,
  };
});

describe("Payment Reconciliation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should sweep stale PENDING_VERIFICATION and reset them to PENDING", async () => {
    const staleAttempt = {
      id: "att_stale",
      status: "PENDING_VERIFICATION",
      provider: "RAZORPAY",
      amount: "100.00",
      tenant_id: "tenant_abc",
      owner_id: "owner_xyz",
      hostel_id: "hostel_123",
      merchant_txn_id: "txn_stale",
      updated_at: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago (stale)
    };

    // Mock passes: Pass 0 (stale PENDING_VERIFICATION), Pass 0 (stale PROCESSING), Pass 1 (stale CREATED), Pass 2 (stale PENDING), Pass 3 (pending status checks)
    vi.mocked(prisma.paymentAttempt.findMany)
      .mockResolvedValueOnce([staleAttempt]) // stale pending verification
      .mockResolvedValueOnce([])             // stale processing
      .mockResolvedValueOnce([])             // stale created
      .mockResolvedValueOnce([])             // auto expire pending
      .mockResolvedValueOnce([])             // orphan success
      .mockResolvedValueOnce([]);            // pending attempts sweep

    const result = await paymentService.reconcilePendingAttempts();

    expect(result.stale_pending_verification_reset).toBe(1);
    expect(prisma.paymentAttempt.update).toHaveBeenCalled();
  });
});
