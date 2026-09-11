import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * "Paid Includes Deposit = No".
 *
 * The template asks the owner whether the amount already paid covers the
 * deposit. It was parsed and stored and then ignored: settlement ran FIFO
 * across every due, deposit included, so answering "No" changed nothing.
 */

const { mockPrisma, mockFacade, mockFinancial } = vi.hoisted(() => {
  const tx: any = {
    rent_obligations: { findMany: vi.fn() },
  };
  return {
    mockPrisma: { __tx: tx } as any,
    mockFacade: { receivePayment: vi.fn() },
    mockFinancial: { getTenantDues: vi.fn() },
  };
});

/**
 * A restatement of the rule, not the service itself — `createInvitation` needs
 * a transaction, a room, a profile and the whole onboarding-financials chain
 * to reach this point. The guard at the bottom of this file is what ties this
 * specification to the real implementation.
 */
async function settle(data: any, opts: { dues: number; obligations: any[] }) {
  mockFinancial.getTenantDues.mockResolvedValue({ total_due: opts.dues });
  mockPrisma.__tx.rent_obligations.findMany.mockResolvedValue(opts.obligations);

  const tx = mockPrisma.__tx;
  const paidAmount = Number(data.paid_amount || 0);
  const owed = await mockFinancial.getTenantDues("t", "o", "h", tx);

  const includesDeposit = data.paid_includes_deposit !== false && data.amount_includes_deposit !== false;
  let obligationIdFilter: string[] | undefined;
  let due = Number(owed?.total_due || 0);

  if (!includesDeposit) {
    const settleable = await tx.rent_obligations.findMany({
      where: { tenant_id: "t", hostel_id: "h", is_superseded: false, obligation_type: { not: "SECURITY_DEPOSIT" } },
      select: { id: true, total_amount: true, amount: true },
    });
    obligationIdFilter = settleable.map((row: any) => row.id);
    due = settleable.reduce((sum: number, row: any) => sum + Number(row.total_amount ?? row.amount ?? 0), 0);
  }

  if (paidAmount > due + 0.01) {
    throw new Error(
      includesDeposit
        ? `VALIDATION_ERROR: Cannot record ₹${paidAmount.toFixed(2)} — only ₹${due.toFixed(2)} is owed`
        : `VALIDATION_ERROR: Cannot record ₹${paidAmount.toFixed(2)} — only ₹${due.toFixed(2)} is owed excluding the deposit. Tick "paid includes deposit" if the deposit is part of this amount.`
    );
  }

  return mockFacade.receivePayment(tx, { amountPaid: paidAmount, ...(obligationIdFilter ? { obligationIdFilter } : {}) }, "g");
}

const RENT = { id: "ob-rent", total_amount: 8500, amount: 8500 };
const MAINT = { id: "ob-maint", total_amount: 500, amount: 500 };

beforeEach(() => {
  vi.clearAllMocks();
  mockFacade.receivePayment.mockResolvedValue({});
});

describe("when the amount does not include the deposit", () => {
  it("keeps the deposit out of the settlement", async () => {
    await settle(
      { paid_amount: 9000, payment_method: "CASH", paid_includes_deposit: false },
      { dues: 34500, obligations: [RENT, MAINT] }
    );

    const [, payload] = mockFacade.receivePayment.mock.calls[0];
    expect(payload.obligationIdFilter).toEqual(["ob-rent", "ob-maint"]);
  });

  it("measures the amount against the dues excluding the deposit", async () => {
    // ₹34,500 is owed in total, but only ₹9,000 of it is not the deposit.
    await expect(
      settle(
        { paid_amount: 20000, payment_method: "CASH", paid_includes_deposit: false },
        { dues: 34500, obligations: [RENT, MAINT] }
      )
    ).rejects.toThrow(/only ₹9000.00 is owed excluding the deposit/);
  });

  it("tells the owner what to do about it", async () => {
    await expect(
      settle(
        { paid_amount: 20000, payment_method: "CASH", paid_includes_deposit: false },
        { dues: 34500, obligations: [RENT, MAINT] }
      )
    ).rejects.toThrow(/paid includes deposit/);
  });
});

describe("when the amount does include the deposit", () => {
  it("settles across everything, as before", async () => {
    await settle(
      { paid_amount: 34500, payment_method: "CASH", paid_includes_deposit: true },
      { dues: 34500, obligations: [] }
    );

    const [, payload] = mockFacade.receivePayment.mock.calls[0];
    expect(payload.obligationIdFilter).toBeUndefined();
    expect(mockPrisma.__tx.rent_obligations.findMany).not.toHaveBeenCalled();
  });

  it("treats an unanswered question as including the deposit", async () => {
    await settle({ paid_amount: 34500, payment_method: "CASH" }, { dues: 34500, obligations: [] });
    const [, payload] = mockFacade.receivePayment.mock.calls[0];
    expect(payload.obligationIdFilter).toBeUndefined();
  });
});

describe("the real service implements this rule", () => {
  // The block above is a restatement; without this, deleting the filter from
  // the service would leave every test in this file green.
  it("filters the settlement by obligation, excluding the deposit", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      "src/services/tenants/tenant-invitation-lifecycle-service.ts",
      "utf8"
    );

    expect(source).toContain("obligationIdFilter");
    expect(source).toContain('obligation_type: { not: "SECURITY_DEPOSIT" }');
    expect(source).toContain("paid_includes_deposit");
  });

  it("forwards the owner's answer from the bulk import", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/bulk-import/[batch_id]/confirm/route.ts", "utf8");
    expect(source).toContain("paid_includes_deposit: data.amount_includes_deposit");
  });
});

