import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invite transaction's settlement of money already handed over (ADR-236).
 *
 * Runs the real `InviteSettlementService` against an in-memory `rent_obligations`
 * store. `financialPaymentFacade.receivePayment` is replaced by a stand-in that
 * runs the real settlement planner over that store and writes what the engine
 * writes (one payment row per allocation, PAID/PARTIAL status, a unique
 * idempotency key) — the engine itself is covered by its own suites; what this
 * pins is what the invite *persists*: which periods exist, which are paid, and
 * that a retry or an over-agreement amount cannot corrupt them.
 */

const store = vi.hoisted(() => ({
  obligations: [] as any[],
  payments: [] as any[],
  seq: 0,
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/preferences", () => ({ resolvePreferences: () => ({ due_day: 5 }) }));

vi.mock("@/src/services/payments/financial-service", () => ({
  financialService: {
    getTenantDues: vi.fn(async (tenantId: string) => ({
      total_due: store.obligations
        .filter((o) => o.tenant_id === tenantId && o.status !== "PAID")
        .reduce((s, o) => s + Number(o.amount), 0),
    })),
  },
}));

vi.mock("@/src/services/payments/financial-payment-facade", async () => {
  const planner = await import("@/src/services/payments/settlement-planner");
  return {
    financialPaymentFacade: {
      receivePayment: vi.fn(async (_tx: any, data: any) => {
        if (data.idempotencyKey && store.payments.some((p) => p.idempotency_key === data.idempotencyKey)) {
          throw Object.assign(new Error("Unique constraint failed on idempotency_key"), { code: "P2002" });
        }
        const rows = store.obligations.filter(
          (o) =>
            o.tenant_id === data.tenantId &&
            planner.PAYABLE_STATUSES.includes(o.status) &&
            (!data.obligationIdFilter || data.obligationIdFilter.includes(o.id))
        );
        const snapshots = rows.map((o) =>
          planner.toObligationSnapshot({
            ...o,
            payments: store.payments.filter((p) => p.obligation_id === o.id),
          })
        );
        const plan = planner.buildSettlementPlan(snapshots, data.amountPaid, {
          allow_partial: true,
          minimum_amount: 0,
          minimum_percentage: 0,
        });
        if (plan.unallocated > 0) throw new Error("BAD_REQUEST: Payment exceeds what can be settled");
        plan.allocations
          .filter((a) => a.allocated > 0)
          .forEach((a, i) => {
            store.payments.push({
              obligation_id: a.obligation_id,
              amount_paid: a.allocated,
              idempotency_key: i === 0 ? data.idempotencyKey : null,
            });
            const row = store.obligations.find((o) => o.id === a.obligation_id);
            row.status = a.result === "PAID" ? "PAID" : "PARTIAL";
          });
        return { allocations: plan.allocations, totalPaid: data.amountPaid } as any;
      }),
    },
  };
});

import { inviteSettlementService } from "@/src/services/payments/invite-settlement-service";
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";

const sameMonth = (a: Date, b: Date) => new Date(a).getTime() === new Date(b).getTime();
const tx = {
  rent_obligations: {
    findMany: vi.fn(async ({ where }: any) =>
      store.obligations.filter(
        (o) =>
          o.tenant_id === where.tenant_id &&
          (!where.obligation_type || typeof where.obligation_type !== "string" || o.obligation_type === where.obligation_type) &&
          (!where.obligation_type?.not || o.obligation_type !== where.obligation_type.not)
      )
    ),
    findFirst: vi.fn(async ({ where }: any) =>
      store.obligations.find(
        (o) => o.tenant_id === where.tenant_id && o.obligation_type === where.obligation_type && sameMonth(o.rent_month, where.rent_month)
      ) ?? null
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `ob-${++store.seq}`, ...data };
      store.obligations.push(row);
      return row;
    }),
  },
  hostels: { findUnique: vi.fn(async () => ({ preferences_config: {} })) },
};

const RENT = 8200;
const JOIN = new Date("2026-08-01T00:00:00.000Z");
const TODAY = new Date("2026-10-07T00:00:00.000Z");
const ym = (d: Date) => new Date(d).toISOString().slice(0, 7);

/** What `initializeOnboardingFinancials` leaves for a tenant joined 1 Aug, invited 7 Oct. */
function seedOnboarding({ deposit = 0 }: { deposit?: number } = {}) {
  if (deposit > 0) {
    store.obligations.push({
      id: "ob-deposit", tenant_id: "t1", obligation_type: "SECURITY_DEPOSIT", amount: deposit, total_amount: deposit,
      rent_month: new Date(Date.UTC(2026, 7, 1)), due_date: JOIN, status: "PENDING", owner_id: "o1",
    });
  }
  for (const month of [7, 8, 9]) {
    store.obligations.push({
      id: `ob-rent-${month}`, tenant_id: "t1", obligation_type: "RENT", amount: RENT, total_amount: RENT,
      rent_month: new Date(Date.UTC(2026, month, 1)), due_date: new Date(Date.UTC(2026, month, 5)), status: "PENDING", owner_id: "o1",
    });
  }
}

const settle = (over: Record<string, unknown> = {}) =>
  inviteSettlementService.settleInTx(tx, {
    tenantId: "t1",
    ownerId: "o1",
    hostelId: "h1",
    invitationId: "inv-1",
    joiningDate: JOIN,
    agreementDurationMonths: 12,
    monthlyRent: RENT,
    paidAmount: 0,
    paymentMethod: "CASH",
    includesDeposit: true,
    today: TODAY,
    ...over,
  } as any);

const rentRows = () =>
  store.obligations.filter((o) => o.obligation_type === "RENT").sort((a, b) => +new Date(a.rent_month) - +new Date(b.rent_month));

beforeEach(() => {
  store.obligations = [];
  store.payments = [];
  store.seq = 0;
  vi.clearAllMocks();
});

describe("inviteSettlementService.settleInTx", () => {
  it("records nothing when nothing was paid", async () => {
    seedOnboarding();
    expect(await settle({ paidAmount: 0 })).toBeNull();
    expect(financialPaymentFacade.receivePayment).not.toHaveBeenCalled();
  });

  it("requires a payment method for a real amount", async () => {
    seedOnboarding();
    await expect(settle({ paidAmount: RENT, paymentMethod: "" })).rejects.toThrow(/payment method is required/);
  });

  it("an amount within today's dues creates no future periods", async () => {
    seedOnboarding();
    const result = await settle({ paidAmount: 2 * RENT });
    expect(result?.advanceObligationIds).toEqual([]);
    expect(rentRows().map((o) => o.status)).toEqual(["PAID", "PAID", "PENDING"]);
  });

  it("12. ₹98,400 persists twelve PAID rent periods, Aug 2026 – Jul 2027, and nothing more", async () => {
    seedOnboarding();
    const result = await settle({ paidAmount: 98400 });

    expect(result?.advanceObligationIds).toHaveLength(9);
    const rows = rentRows();
    expect(rows.map((o) => ym(o.rent_month))).toEqual([
      "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01",
      "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07",
    ]);
    expect(rows.every((o) => o.status === "PAID")).toBe(true);
    // Future periods were born UPCOMING with the dual-written lifecycle columns.
    const nov = rows[3];
    expect(nov.lifecycle_status).toBe("ACTIVE");
    expect(nov.due_date.toISOString().slice(0, 10)).toBe("2026-11-05");
    // Payment ≠ allocation: one row per period, summing to the payment exactly.
    expect(store.payments).toHaveLength(12);
    expect(store.payments.reduce((s, p) => s + Math.round(p.amount_paid * 100), 0)).toBe(9840000);
  });

  it("7. ₹90,000 leaves ten periods PAID and the eleventh PARTIAL by ₹200 — not rounded up", async () => {
    seedOnboarding();
    await settle({ paidAmount: 90000 });
    const rows = rentRows();
    expect(rows).toHaveLength(11);
    expect(rows.slice(0, 10).every((o) => o.status === "PAID")).toBe(true);
    expect(rows[10].status).toBe("PARTIAL");
    expect(ym(rows[10].rent_month)).toBe("2027-06");
    const paidOnJune = store.payments.filter((p) => p.obligation_id === rows[10].id).reduce((s, p) => s + p.amount_paid, 0);
    expect(paidOnJune).toBe(8000);
  });

  it("8. exactly the 11-month agreement's rent (₹90,200) is accepted in full", async () => {
    seedOnboarding();
    await settle({ agreementDurationMonths: 11, paidAmount: 90200 });
    expect(rentRows()).toHaveLength(11);
    expect(rentRows().every((o) => o.status === "PAID")).toBe(true);
  });

  it("9. more than the agreement's rent is refused with the recordable figure, and nothing is written", async () => {
    seedOnboarding();
    await expect(settle({ agreementDurationMonths: 11, paidAmount: 98400 })).rejects.toThrow(
      /₹98,400 is ₹8,200 more than this 11-month agreement can take through Jun 2027\. Record ₹90,200 or less/
    );
    expect(rentRows()).toHaveLength(3);
    expect(store.payments).toHaveLength(0);
  });

  it("13. a retried settlement for the same invitation does not allocate twice", async () => {
    seedOnboarding();
    await settle({ paidAmount: 98400 });
    const payments = store.payments.length;
    // Refused either by the agreement having no unpaid period left or by the
    // invitation's idempotency key — whichever fires first, nothing is written.
    await expect(settle({ paidAmount: 98400 })).rejects.toThrow();
    expect(store.payments).toHaveLength(payments);
    expect(rentRows()).toHaveLength(12);
  });

  it("14. a future period created concurrently (e.g. by the cron) is reused, never duplicated", async () => {
    seedOnboarding();
    store.obligations.push({
      id: "ob-cron-nov", tenant_id: "t1", obligation_type: "RENT", amount: RENT, total_amount: RENT,
      rent_month: new Date(Date.UTC(2026, 10, 1)), due_date: new Date(Date.UTC(2026, 10, 5)), status: "PENDING", owner_id: "o1",
    });
    const result = await settle({ paidAmount: 5 * RENT });
    expect(result?.advanceObligationIds).not.toContain("ob-cron-nov"); // it was already existing, so not "advance"
    const months = rentRows().map((o) => ym(o.rent_month));
    expect(new Set(months).size).toBe(months.length);
    expect(months).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
  });

  it("15. the deposit is settled as the deposit, and only the remainder becomes rent", async () => {
    seedOnboarding({ deposit: 16400 });
    await settle({ paidAmount: 98400 });
    expect(store.obligations.find((o) => o.id === "ob-deposit")?.status).toBe("PAID");
    // ₹82,000 of rent = 10 months.
    expect(rentRows().filter((o) => o.status === "PAID")).toHaveLength(10);
    expect(rentRows()).toHaveLength(10);
  });

  it("15b. 'does not include the deposit' keeps the deposit owed and lets advance periods into the settlement", async () => {
    seedOnboarding({ deposit: 16400 });
    await settle({ paidAmount: 5 * RENT, includesDeposit: false });
    expect(store.obligations.find((o) => o.id === "ob-deposit")?.status).toBe("PENDING");
    const call = vi.mocked(financialPaymentFacade.receivePayment).mock.calls[0][1];
    expect(call.obligationIdFilter).not.toContain("ob-deposit");
    expect(call.obligationIdFilter).toHaveLength(5); // 3 onboarding + 2 advance
    expect(rentRows().every((o) => o.status === "PAID")).toBe(true);
  });

  it("13b. the idempotency key alone refuses a replay that would otherwise fit", async () => {
    seedOnboarding();
    await settle({ paidAmount: RENT });
    await expect(settle({ paidAmount: RENT })).rejects.toThrow(/Unique constraint/);
    expect(store.payments).toHaveLength(1);
  });

  it("carries the one-settlement-per-invitation idempotency key", async () => {
    seedOnboarding();
    await settle({ paidAmount: RENT });
    expect(vi.mocked(financialPaymentFacade.receivePayment).mock.calls[0][1].idempotencyKey).toBe("invite-settle:inv-1");
  });
});

describe("a tenant who paid ₹75,000 upfront in January at ₹7,500, added to Stayo on 10 June", () => {
  const JAN_JOIN = new Date("2026-01-01T00:00:00.000Z");
  const JUNE = new Date("2026-06-10T00:00:00.000Z");

  /** What onboarding leaves on 10 June: one PENDING RENT row per elapsed month, Jan–Jun. */
  function seedJanToJune() {
    for (let month = 0; month < 6; month++) {
      store.obligations.push({
        id: `ob-rent-${month}`, tenant_id: "t1", obligation_type: "RENT", amount: 7500, total_amount: 7500,
        rent_month: new Date(Date.UTC(2026, month, 1)), due_date: new Date(Date.UTC(2026, month, 5)),
        status: "PENDING", owner_id: "o1",
      });
    }
  }

  const settleJanuary = (over: Record<string, unknown> = {}) =>
    settle({ joiningDate: JAN_JOIN, monthlyRent: 7500, paidAmount: 75000, today: JUNE, paymentDate: "2026-01-03", ...over });

  it("persists January–October as PAID — June included — and creates nothing past October", async () => {
    seedJanToJune();
    const result = await settleJanuary();
    const rows = rentRows();
    expect(rows.map((o) => ym(o.rent_month))).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(rows.every((o) => o.status === "PAID")).toBe(true);
    expect(result?.advanceObligationIds).toHaveLength(4); // Jul–Oct
  });

  it("records the payment on the day it was actually made, not the day it was entered", async () => {
    seedJanToJune();
    await settleJanuary();
    const call = vi.mocked(financialPaymentFacade.receivePayment).mock.calls[0][1];
    expect(call.paymentDate!.toISOString().slice(0, 10)).toBe("2026-01-03");
  });

  it("defaults to today when no payment date is given", async () => {
    seedJanToJune();
    await settleJanuary({ paymentDate: undefined });
    const call = vi.mocked(financialPaymentFacade.receivePayment).mock.calls[0][1];
    expect(call.paymentDate!.toISOString().slice(0, 10)).toBe("2026-06-10");
  });

  it("refuses a payment date in the future, and writes nothing", async () => {
    seedJanToJune();
    await expect(settleJanuary({ paymentDate: "2026-07-01" })).rejects.toThrow(/cannot be in the future/);
    expect(store.payments).toHaveLength(0);
    expect(rentRows()).toHaveLength(6);
  });

  it("refuses a malformed payment date", async () => {
    seedJanToJune();
    await expect(settleJanuary({ paymentDate: "not-a-date" })).rejects.toThrow(/not a valid date/);
  });
});
