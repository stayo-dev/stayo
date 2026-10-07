import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 11. Recurring billing respects prepaid coverage (ADR-236).
 *
 * Runs the real monthly generator (`rentGenerationService.generateMonthlyRent`)
 * against a tenant whose rent was paid through Jul 2027 at invite time. The
 * prepaid months exist as RENT rows keyed by tenant + month, so the generator
 * must create nothing for them — and must bill Aug 2027 as normal once the
 * coverage has run out. Without this, an owner who recorded a year's rent
 * would see the tenant fall due again the very next month.
 */

const db = vi.hoisted(() => ({ obligations: [] as any[], created: [] as any[], rent: 8200 }));

vi.mock("@/lib/db", () => {
  const sameMonth = (a: Date, b: Date) => new Date(a).getTime() === new Date(b).getTime();
  const tx = {
    rent_obligations: {
      createMany: vi.fn(async ({ data }: any) => {
        db.created.push(...data);
        db.obligations.push(...data);
        return { count: data.length };
      }),
      findMany: vi.fn(async () => []),
    },
  };
  return {
    prisma: {
      $executeRaw: vi.fn(async () => 1),
      $transaction: vi.fn(async (fn: any) => fn(tx)),
      hostels: {
        findUnique: vi.fn(async () => ({ status: "ACTIVE", owner_id: "o1" })),
        findMany: vi.fn(async () => [{ id: "h1", status: "ACTIVE", preferences_config: {} }]),
      },
      roomAllocation: {
        findMany: vi.fn(async () => [
          {
            id: "alloc-1",
            hostel_id: "h1",
            tenant: { id: "t1", monthly_rent: db.rent, owner_id: "o1", maintenance_charge: 0, maintenance_type: "NONE", payment_frequency: "MONTHLY" },
            room: { base_rent: 8200, hostel_id: "h1" },
          },
        ]),
      },
      rent_obligations: {
        findMany: vi.fn(async ({ where }: any) =>
          db.obligations.filter((o) => sameMonth(o.rent_month, where.rent_month) && o.tenant_id === "t1")
        ),
      },
      agreement: { findMany: vi.fn(async () => []) },
      tenant_billing_plans: { findMany: vi.fn(async () => []) },
      rent_generation_logs: { create: vi.fn(async () => ({})) },
    },
  };
});

vi.mock("@/lib/events", () => ({ eventSystem: { trigger: vi.fn(async () => undefined) } }));
vi.mock("@/lib/cache/dashboard-cache", () => ({
  invalidateOwnerDashboardCache: vi.fn(),
  invalidateHostelDashboardCache: vi.fn(),
}));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn(async () => undefined) } }));
vi.mock("@/lib/services/rent-generation-ledger-service", () => ({
  rentGenerationLedgerService: {
    hasCompleted: vi.fn(async () => false),
    skip: vi.fn(async () => undefined),
    startOrReuse: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  },
}));
vi.mock("@/src/services/payments/agreement-rent-schedule-service", () => ({
  agreementRentScheduleService: { syncDueStatuses: vi.fn(async () => ({ pending: 0, overdue: 0 })) },
}));
vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: { activatePayableObligations: vi.fn(async () => []), notifyActivated: vi.fn() },
}));

import { rentGenerationService } from "@/src/services/payments/rent-generation-service";

/** What the invite leaves after recording ₹98,400 for a tenant joined 1 Aug 2026: Aug 2026 – Jul 2027, all PAID. */
function seedPrepaidYear() {
  for (let i = 0; i < 12; i++) {
    db.obligations.push({
      tenant_id: "t1",
      allocation_id: null,
      obligation_type: "RENT",
      rent_month: new Date(Date.UTC(2026, 7 + i, 1)),
      amount: 8200,
      status: "PAID",
    });
  }
}

// Mid-month, so the generator's local-day guard and the UTC month key agree.
const runFor = (year: number, month0: number) =>
  rentGenerationService.generateMonthlyRent(new Date(Date.UTC(year, month0, 15, 6)), "o1", "manual", "h1");

beforeEach(() => {
  db.obligations = [];
  db.created = [];
  db.rent = 8200;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("monthly rent generation after an advance payment", () => {
  it("bills nothing for any prepaid month, Nov 2026 through Jul 2027", async () => {
    seedPrepaidYear();
    for (let i = 3; i < 12; i++) {
      await runFor(2026, 7 + i);
    }
    expect(db.created).toEqual([]);
  });

  it("bills Aug 2027 as the next rent, once the coverage has run out", async () => {
    seedPrepaidYear();
    await runFor(2027, 7);
    expect(db.created).toHaveLength(1);
    expect(db.created[0]).toMatchObject({ tenant_id: "t1", obligation_type: "RENT", amount: 8200, status: "PENDING" });
    expect(new Date(db.created[0].rent_month).toISOString().slice(0, 7)).toBe("2027-08");
  });

  it("control: without prepaid rows the same month is billed", async () => {
    await runFor(2026, 10);
    expect(db.created).toHaveLength(1);
  });
});

describe("₹75,000 paid upfront in January at ₹7,500, Stayo introduced in June", () => {
  /** What the invite leaves: Jan–Oct 2026, all PAID. */
  function seedJanToOctober() {
    db.rent = 7500;
    for (let month = 0; month < 10; month++) {
      db.obligations.push({
        tenant_id: "t1", allocation_id: null, obligation_type: "RENT",
        rent_month: new Date(Date.UTC(2026, month, 1)), amount: 7500, status: "PAID",
      });
    }
  }

  it("June does not become due again when Stayo's June run happens", async () => {
    seedJanToOctober();
    await runFor(2026, 5);
    expect(db.created).toEqual([]);
  });

  it("July through October are not billed either", async () => {
    seedJanToOctober();
    for (const month0 of [6, 7, 8, 9]) await runFor(2026, month0);
    expect(db.created).toEqual([]);
  });

  it("rent is generated from November onward", async () => {
    seedJanToOctober();
    await runFor(2026, 10);
    await runFor(2026, 11);
    expect(db.created.map((r) => new Date(r.rent_month).toISOString().slice(0, 7))).toEqual(["2026-11", "2026-12"]);
    expect(db.created.every((r) => r.amount === 7500 && r.status === "PENDING")).toBe(true);
  });
});
