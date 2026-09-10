import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Dues must be readable **inside** the transaction that is creating the
 * obligations.
 *
 * The bug this pins: `createInvitation` records money the tenant has already
 * handed over. Inside one `prisma.$transaction`, it creates the obligations
 * (`initializeOnboardingFinancials(tx, …)`, via `tx.rent_obligations.create`)
 * and then checks the amount against what is owed. That check called
 * `financialService.getTenantDues(…)`, which reached `billingRepository`,
 * which queried the **global** Prisma client — a different connection, which
 * under READ COMMITTED cannot see rows the open transaction has not committed.
 *
 * So the read returned zero obligations, `total_due` was ₹0.00, and the guard
 * refused *every* amount: "Cannot record ₹15000.00 — only ₹0.00 is owed". The
 * feature could never have worked for any invite.
 *
 * The tell was in the same function: `financialPaymentFacade.receivePayment`
 * is handed `tx` and reads `tx.rent_obligations.findMany`, so the allocation
 * that follows the guard sees exactly the rows the guard could not.
 *
 * These tests mock `@/lib/db` so the global client returns nothing, which is
 * precisely the production condition — the rows exist only on the transaction.
 */

const mocks = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    rent_obligations: { findMany: mocks.globalFindMany },
  },
}));

vi.mock("@/lib/preferences", () => ({
  resolvePreferences: vi.fn().mockResolvedValue({}),
}));

import { financialService } from "@/src/services/payments/financial-service";

const obligation = (over: Record<string, unknown> = {}) => ({
  id: "ob-1",
  obligation_type: "RENT",
  rent_month: new Date("2026-09-01"),
  due_date: new Date("2026-09-05"),
  amount: 8000,
  total_amount: 8000,
  status: "PENDING",
  late_fee: 0,
  payments: [],
  room_allocations: null,
  ...over,
});

describe("getTenantDues — transaction scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The production condition: the obligations are uncommitted, so a query on
    // the global pool finds nothing at all.
    mocks.globalFindMany.mockResolvedValue([]);
  });

  it("reads through the transaction client it is given", async () => {
    const txFindMany = vi.fn().mockResolvedValue([obligation()]);
    const tx = { rent_obligations: { findMany: txFindMany } };

    const dues = await financialService.getTenantDues("tenant-1", "owner-1", "hostel-1", tx as any);

    expect(dues.total_due).toBe(8000);
    expect(txFindMany).toHaveBeenCalled();
    // The whole point: the global client must not be consulted when a
    // transaction client is supplied, or the read races the write it depends on.
    expect(mocks.globalFindMany).not.toHaveBeenCalled();
  });

  it("sees an upfront payment as payable, rather than reporting nothing owed", async () => {
    // The reported symptom, at the layer that caused it: a deposit and a first
    // month created moments earlier inside the transaction.
    const tx = {
      rent_obligations: {
        findMany: vi.fn().mockResolvedValue([
          obligation({ id: "ob-dep", obligation_type: "SECURITY_DEPOSIT", amount: 7000, total_amount: 7000 }),
          obligation({ id: "ob-rent", amount: 8000, total_amount: 8000 }),
        ]),
      },
    };

    const dues = await financialService.getTenantDues("tenant-1", "owner-1", "hostel-1", tx as any);

    expect(dues.total_due).toBe(15000);
    expect(dues.security_deposit_due).toBe(7000);
    expect(dues.rent_due).toBe(8000);
  });

  it("still uses the global client when no transaction is given", async () => {
    // Every other caller reads committed state and must keep working unchanged.
    mocks.globalFindMany.mockResolvedValue([obligation()]);

    const dues = await financialService.getTenantDues("tenant-1", "owner-1", "hostel-1");

    expect(dues.total_due).toBe(8000);
    expect(mocks.globalFindMany).toHaveBeenCalled();
  });
});
