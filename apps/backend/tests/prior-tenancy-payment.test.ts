import { describe, it, expect } from "vitest";
import {
  resolvePriorTenancyPayment,
  PRIOR_HISTORY_CAP_MONTHS,
} from "@/lib/billing/prior-tenancy-payment";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const resolve = (over: Partial<Parameters<typeof resolvePriorTenancyPayment>[0]> = {}) =>
  resolvePriorTenancyPayment({
    joiningDate: utc("2026-05-12"),
    today: utc("2026-08-29"),
    monthlyRent: 8000,
    securityDeposit: 16000,
    maintenanceCharge: 0,
    maintenanceType: "NONE",
    dueDay: 5,
    rentPaidThrough: null,
    depositPaid: false,
    maintenancePaid: false,
    ...over,
  });

/**
 * The one conversion from the owner's answers to a rupee amount. Both the
 * preview the owner sees and the payment recorded at invite go through it, so
 * a bug here is a bug in both at once — hence covered without a database.
 */
describe("resolvePriorTenancyPayment", () => {
  it("lists every month of the stay, oldest first", () => {
    expect(resolve().months.map((m) => m.key)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
  });

  it("dues the joining month on the literal joining date, matching what the writer creates", () => {
    // onboarding-financials-service keeps the joining month's original rule and
    // uses the hostel due day only for the months after it. A preview that
    // disagreed with that would be worse than none.
    const months = resolve().months;
    expect(months[0].dueDate.toISOString().slice(0, 10)).toBe("2026-05-12");
    expect(months[1].dueDate.toISOString().slice(0, 10)).toBe("2026-06-05");
    expect(months[3].dueDate.toISOString().slice(0, 10)).toBe("2026-08-05");
  });

  it("honours a different hostel due day", () => {
    expect(resolve({ dueDay: 10 }).months[1].dueDate.toISOString().slice(0, 10)).toBe("2026-06-10");
  });

  it("settles through the named month and no further", () => {
    const plan = resolve({ rentPaidThrough: "2026-07" });
    expect(plan.months.map((m) => m.settled)).toEqual([true, true, true, false]);
    expect(plan.amountPaid).toBe(24000);
  });

  it("adds the deposit only when the owner says it is in hand", () => {
    expect(resolve({ rentPaidThrough: "2026-07" }).amountPaid).toBe(24000);

    const withDeposit = resolve({ rentPaidThrough: "2026-07", depositPaid: true });
    expect(withDeposit.amountPaid).toBe(24000 + 16000);
    expect(withDeposit.amountIncludesDeposit).toBe(true);
  });

  it("never counts maintenance the hostel does not charge", () => {
    expect(resolve({ maintenanceType: "NONE", maintenanceCharge: 500, maintenancePaid: true }).amountPaid).toBe(0);
    expect(
      resolve({ maintenanceType: "MONTHLY", maintenanceCharge: 500, maintenancePaid: true }).amountPaid,
    ).toBe(500);
  });

  it("reports nothing paid when the owner has collected nothing", () => {
    const plan = resolve();
    expect(plan.amountPaid).toBe(0);
    expect(plan.amountIncludesDeposit).toBe(false);
    expect(plan.months.every((m) => m.settled)).toBe(false);
  });

  it("caps a very long stay the same way the writer caps its backfill", () => {
    // Both keep the most recent months; the live month's rent matters most.
    const plan = resolve({ joiningDate: utc("2019-01-01") });
    expect(plan.truncated).toBe(true);
    expect(plan.months).toHaveLength(PRIOR_HISTORY_CAP_MONTHS);
    expect(plan.months[plan.months.length - 1].key).toBe("2026-08");
  });

  it("does not flag a stay inside the cap", () => {
    expect(resolve({ joiningDate: utc("2024-09-01") }).truncated).toBe(false);
  });

  it("returns a single month for someone who moved in this month", () => {
    expect(resolve({ joiningDate: utc("2026-08-03") }).months.map((m) => m.key)).toEqual(["2026-08"]);
  });

  it("plans nothing for a future move-in", () => {
    expect(resolve({ joiningDate: utc("2026-10-01") }).months).toEqual([]);
  });

  it("plans no rent months when there is no rent", () => {
    const plan = resolve({ monthlyRent: 0, depositPaid: true });
    expect(plan.months).toEqual([]);
    expect(plan.amountPaid).toBe(16000);
  });

  it("ignores a malformed or out-of-range paid-through value", () => {
    expect(resolve({ rentPaidThrough: "nonsense" }).amountPaid).toBe(0);
    expect(resolve({ rentPaidThrough: "2020-01" }).amountPaid).toBe(0);
    expect(resolve({ rentPaidThrough: "2030-01" }).amountPaid).toBe(4 * 8000);
  });
});
