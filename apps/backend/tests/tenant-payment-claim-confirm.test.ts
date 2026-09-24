import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Confirming a tenant's UPI claim — the point at which evidence becomes money.
 *
 * Two things are load-bearing and neither is visible from the happy path: a
 * claim may only be acted on by the owner it belongs to, and it may only be
 * acted on once. This codebase has already shipped a cross-owner IDOR on an
 * obligation route, and obligations are audit-first with no edit endpoint, so
 * a double confirmation credits the same rent twice with no clean way back.
 *
 * Pure: `@/lib/db` and every side-effect module are mocked. No database.
 */

const claimFindUnique = vi.fn();
const claimUpdate = vi.fn();
const settleInTx = vi.fn();
const txClaimUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant_payment_claims: {
      findUnique: (...a: any[]) => claimFindUnique(...a),
      update: (...a: any[]) => claimUpdate(...a),
    },
    $transaction: async (fn: any) =>
      fn({ tenant_payment_claims: { update: (...a: any[]) => txClaimUpdate(...a) } }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  getLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn() } }));
vi.mock("../lib/events", () => ({ eventSystem: { trigger: vi.fn() } }));
vi.mock("@/lib/events", () => ({ eventSystem: { trigger: vi.fn() } }));

import { paymentService } from "@/src/services/payments/payment-service";

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER_OWNER = "22222222-2222-2222-2222-222222222222";

function pendingClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: "claim-1",
    owner_id: OWNER,
    tenant_id: "tenant-1",
    hostel_id: "hostel-1",
    obligation_id: "ob-1",
    claimed_amount: BigInt(850000),
    utr: "123456789012",
    state: "PENDING",
    ...overrides,
  };
}

beforeEach(() => {
  claimFindUnique.mockReset();
  claimUpdate.mockReset();
  txClaimUpdate.mockReset();
  settleInTx.mockReset();
  settleInTx.mockResolvedValue({ groupId: "group-1", allocations: [] });
  (paymentService as any)._settleTenantRentPaymentInTx = settleInTx;
});

describe("confirmTenantPaymentClaim", () => {
  it("refuses a claim belonging to another owner", async () => {
    claimFindUnique.mockResolvedValue(pendingClaim({ owner_id: OTHER_OWNER }));

    await expect(
      paymentService.confirmTenantPaymentClaim({ claimId: "claim-1", ownerId: OWNER, actorId: "u1" }),
    ).rejects.toThrow(/FORBIDDEN/);

    // Nothing may settle on the way to being refused.
    expect(settleInTx).not.toHaveBeenCalled();
  });

  it("refuses a claim that was already confirmed", async () => {
    claimFindUnique.mockResolvedValue(pendingClaim({ state: "CONFIRMED" }));

    await expect(
      paymentService.confirmTenantPaymentClaim({ claimId: "claim-1", ownerId: OWNER, actorId: "u1" }),
    ).rejects.toThrow(/already confirmed/i);
    expect(settleInTx).not.toHaveBeenCalled();
  });

  it("refuses a claim the owner already rejected", async () => {
    claimFindUnique.mockResolvedValue(pendingClaim({ state: "REJECTED" }));
    await expect(
      paymentService.confirmTenantPaymentClaim({ claimId: "claim-1", ownerId: OWNER, actorId: "u1" }),
    ).rejects.toThrow(/already rejected/i);
  });

  it("records the rent through the shared settlement path, not its own writes", async () => {
    // If this ever stops holding, FIFO allocation and receipts have a second
    // implementation and the two will drift.
    claimFindUnique.mockResolvedValue(pendingClaim());

    await paymentService.confirmTenantPaymentClaim({
      claimId: "claim-1",
      ownerId: OWNER,
      actorId: "u1",
    });

    expect(settleInTx).toHaveBeenCalledTimes(1);
    const [, data] = settleInTx.mock.calls[0];
    expect(data.tenantId).toBe("tenant-1");
    expect(data.paymentMethod).toBe("UPI");
    expect(data.referenceNumber).toBe("123456789012");
  });

  it("converts stored paise into the rupees the settlement path expects", async () => {
    // claimed_amount is integer paise; the ledger takes rupees. Getting this
    // backwards would record 100x the rent.
    claimFindUnique.mockResolvedValue(pendingClaim({ claimed_amount: BigInt(850000) }));

    await paymentService.confirmTenantPaymentClaim({
      claimId: "claim-1",
      ownerId: OWNER,
      actorId: "u1",
    });

    expect(settleInTx.mock.calls[0][1].amountPaid).toBe(8500);
  });

  it("flips the claim inside the same transaction as the settlement", async () => {
    // A crash between the two would leave rent recorded against a claim that
    // still reads PENDING — which is how the same money gets confirmed twice.
    claimFindUnique.mockResolvedValue(pendingClaim());

    await paymentService.confirmTenantPaymentClaim({
      claimId: "claim-1",
      ownerId: OWNER,
      actorId: "u1",
    });

    expect(txClaimUpdate).toHaveBeenCalledTimes(1);
    expect(txClaimUpdate.mock.calls[0][0].data.state).toBe("CONFIRMED");
    expect(claimUpdate).not.toHaveBeenCalled();
  });

  it("scopes settlement to the claim's own obligation", async () => {
    claimFindUnique.mockResolvedValue(pendingClaim({ obligation_id: "ob-9" }));
    await paymentService.confirmTenantPaymentClaim({
      claimId: "claim-1",
      ownerId: OWNER,
      actorId: "u1",
    });
    expect(settleInTx.mock.calls[0][1].allowedObligationIds).toEqual(["ob-9"]);
  });

  it("reports a missing claim as not found", async () => {
    claimFindUnique.mockResolvedValue(null);
    await expect(
      paymentService.confirmTenantPaymentClaim({ claimId: "nope", ownerId: OWNER, actorId: "u1" }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("rejectTenantPaymentClaim", () => {
  it("refuses another owner's claim", async () => {
    claimFindUnique.mockResolvedValue(pendingClaim({ owner_id: OTHER_OWNER }));
    await expect(
      paymentService.rejectTenantPaymentClaim({ claimId: "claim-1", ownerId: OWNER, actorId: "u1" }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("never settles anything", async () => {
    claimFindUnique.mockResolvedValue(pendingClaim());
    await paymentService.rejectTenantPaymentClaim({
      claimId: "claim-1",
      ownerId: OWNER,
      actorId: "u1",
      reason: "Nothing arrived",
    });
    expect(settleInTx).not.toHaveBeenCalled();
    expect(claimUpdate.mock.calls[0][0].data.state).toBe("REJECTED");
  });

  it("clamps an overlong reason rather than storing it whole", () => {
    claimFindUnique.mockResolvedValue(pendingClaim());
    return paymentService
      .rejectTenantPaymentClaim({
        claimId: "claim-1",
        ownerId: OWNER,
        actorId: "u1",
        reason: "x".repeat(5000),
      })
      .then(() => {
        expect(claimUpdate.mock.calls[0][0].data.rejection_reason.length).toBe(500);
      });
  });
});
