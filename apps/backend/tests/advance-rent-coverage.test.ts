import { describe, expect, it } from "vitest";
import { buildInviteSettlementPreview } from "@/lib/billing/invite-settlement-preview";
import { planAdvanceRentMonths, summarizeRentCoverage } from "@/src/services/payments/advance-rent-coverage";

/**
 * Advance rent at invite (ADR-236).
 *
 * The bug: an owner inviting a tenant who had paid a year up front —
 * ₹98,400 at ₹8,200 a month — was told "Cannot record ₹98400.00 — only
 * ₹41000.00 is owed", because only the months up to today existed to pay
 * against. These pin the rule that replaced it: money lands on the agreement's
 * periods oldest first, reaching into future months, and only money past the
 * agreement's end is refused.
 */

const RENT = 8200;
const m = (year: number, month1: number) => new Date(Date.UTC(year, month1 - 1, 1));
const iso = (d: Date | null | undefined) => d?.toISOString().slice(0, 7) ?? null;

/** Joined 1 Aug 2026; today is 7 Oct 2026 — Aug, Sep, Oct have elapsed. */
const JOIN = new Date("2026-08-01T00:00:00.000Z");
const TODAY = new Date("2026-10-07T00:00:00.000Z");

function preview(over: Partial<Parameters<typeof buildInviteSettlementPreview>[0]> = {}) {
  return buildInviteSettlementPreview({
    monthlyRent: RENT,
    securityDeposit: 0,
    maintenanceCharge: 0,
    maintenanceType: "NONE",
    agreementStartDate: JOIN,
    durationMonths: 12,
    dueDay: 5,
    amountPaid: 0,
    amountIncludesDeposit: true,
    today: TODAY,
    ...over,
  });
}

describe("planAdvanceRentMonths", () => {
  const base = {
    joiningDate: JOIN,
    durationMonths: 12,
    monthlyRent: RENT,
    dueDay: 5,
    existingRentMonths: [m(2026, 8), m(2026, 9), m(2026, 10)],
    today: TODAY,
  };

  it("plans nothing when the payment fits inside what exists", () => {
    const plan = planAdvanceRentMonths({ ...base, amountNeeded: 0 });
    expect(plan.months).toEqual([]);
    expect(plan.exhausted).toBe(false);
  });

  it("plans only as many future months as the money needs, starting after the latest existing month", () => {
    const plan = planAdvanceRentMonths({ ...base, amountNeeded: 2 * RENT });
    expect(plan.months.map((x) => iso(x.rent_month))).toEqual(["2026-11", "2026-12"]);
    expect(plan.coveredAmount).toBe(2 * RENT);
    expect(plan.exhausted).toBe(false);
  });

  it("rounds a part-month up to a whole period — the period exists, the planner settles part of it", () => {
    const plan = planAdvanceRentMonths({ ...base, amountNeeded: RENT + 1 });
    expect(plan.months).toHaveLength(2);
  });

  it("future months are UPCOMING with the hostel's due day and whole-month periods", () => {
    const [nov] = planAdvanceRentMonths({ ...base, amountNeeded: RENT }).months;
    expect(nov.status).toBe("UPCOMING");
    expect(nov.due_date.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(nov.period_start.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(nov.period_end.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(nov.amount).toBe(RENT);
    expect(nov.label).toContain("Rent");
  });

  it("never plans a month past the agreement — reports the shortfall as exhausted instead", () => {
    // 12-month agreement, 3 months exist, 9 remain = ₹73,800 of room.
    const plan = planAdvanceRentMonths({ ...base, amountNeeded: 10 * RENT });
    expect(plan.months).toHaveLength(9);
    expect(iso(plan.months[8].rent_month)).toBe("2027-07");
    expect(plan.coveredAmount).toBe(9 * RENT);
    expect(plan.exhausted).toBe(true);
    expect(iso(plan.lastAgreementMonth)).toBe("2027-07");
  });

  it("starts at the joining month for a tenant joining in the future, due on the joining date", () => {
    const join = new Date("2026-12-15T00:00:00.000Z");
    const plan = planAdvanceRentMonths({ ...base, joiningDate: join, existingRentMonths: [], amountNeeded: 2 * RENT });
    expect(plan.months.map((x) => iso(x.rent_month))).toEqual(["2026-12", "2027-01"]);
    expect(plan.months[0].due_date).toEqual(join);
    expect(plan.months[0].period_start).toEqual(join);
  });

  it("refuses to plan without a rent or a term", () => {
    expect(planAdvanceRentMonths({ ...base, monthlyRent: 0, amountNeeded: 100 }).exhausted).toBe(true);
    expect(planAdvanceRentMonths({ ...base, durationMonths: 0, amountNeeded: 100 }).exhausted).toBe(true);
  });
});

describe("invite preview — paying ahead", () => {
  it("1. one month's payment covers the oldest month only", () => {
    const p = preview({ amountPaid: RENT });
    expect(p.unallocated).toBe(0);
    expect(p.advance_rent_months).toEqual([]);
    expect(p.coverage.months_covered).toBe(1);
    expect(iso(p.coverage.paid_through_month)).toBe("2026-08");
    expect(p.coverage.current_due).toBe(2 * RENT);
    expect(iso(p.coverage.next_due_month)).toBe("2026-09");
  });

  it("2. two months' payment in a brand-new tenancy covers this month and next", () => {
    const join = new Date("2026-10-01T00:00:00.000Z");
    const p = preview({ agreementStartDate: join, amountPaid: 2 * RENT });
    expect(p.advance_rent_months.map(iso)).toEqual(["2026-11"]);
    expect(p.coverage.months_covered).toBe(2);
    expect(iso(p.coverage.paid_through_month)).toBe("2026-11");
    expect(p.coverage.current_due).toBe(0);
    expect(p.coverage.future_rent_covered).toBe(RENT);
  });

  it("4 & 10. ₹98,400 — twelve months — with today in October covers Aug 2026 through Jul 2027", () => {
    const p = preview({ amountPaid: 98400 });
    expect(p.unallocated).toBe(0);
    expect(p.max_recordable).toBe(98400);
    expect(p.owed_today).toBe(3 * RENT);
    expect(p.advance_rent_months.map(iso)).toEqual([
      "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07",
    ]);
    expect(p.coverage.months_covered).toBe(12);
    expect(iso(p.coverage.paid_through_month)).toBe("2027-07");
    expect(p.coverage.current_due).toBe(0);
    expect(p.coverage.future_rent_covered).toBe(9 * RENT);
    expect(p.coverage.partial).toBeNull();
    expect(iso(p.coverage.next_due_month)).toBe("2027-08");
  });

  it("5. a payment larger than what is due today is not refused — it reaches into future months", () => {
    const p = preview({ amountPaid: 5 * RENT });
    expect(p.unallocated).toBe(0);
    expect(p.coverage.months_covered).toBe(5);
    expect(iso(p.coverage.paid_through_month)).toBe("2026-12");
  });

  it("6. a partial payment leaves the oldest unpaid month part-paid and says how much is still due", () => {
    const p = preview({ amountPaid: 5000 });
    expect(p.coverage.months_covered).toBe(0);
    expect(p.coverage.paid_through_month).toBeNull();
    expect(iso(p.coverage.partial?.rent_month)).toBe("2026-08");
    expect(p.coverage.partial?.remaining).toBe(3200);
    expect(p.coverage.current_due).toBe(3 * RENT - 5000);
  });

  it("7. ₹90,000 is 10 full months plus ₹8,000 toward the 11th — never rounded up to 11", () => {
    const p = preview({ amountPaid: 90000 });
    expect(p.unallocated).toBe(0);
    expect(p.coverage.months_covered).toBe(10);
    expect(iso(p.coverage.paid_through_month)).toBe("2027-05");
    expect(iso(p.coverage.partial?.rent_month)).toBe("2027-06");
    expect(p.coverage.partial?.allocated).toBe(8000);
    expect(p.coverage.partial?.remaining).toBe(200);
    // The ₹200 belongs to June 2027 — it is not due today.
    expect(p.coverage.current_due).toBe(0);
    const june = p.allocations.find((a) => iso(a.rent_month) === "2027-06");
    expect(june?.result).toBe("PARTIAL");
  });

  it("3 & 8. an 11-month agreement paid in full up front: ₹90,200, nothing due, paid through its last month", () => {
    const p = preview({ durationMonths: 11, amountPaid: 11 * RENT });
    expect(p.unallocated).toBe(0);
    expect(p.coverage.months_covered).toBe(11);
    expect(iso(p.coverage.paid_through_month)).toBe("2027-06");
    expect(iso(p.agreement.last_month)).toBe("2027-06");
    expect(p.coverage.current_due).toBe(0);
    expect(p.remaining_outstanding).toBe(0);
  });

  it("9. more than the agreement's rent is reported as excess, with the figure that can be recorded", () => {
    const p = preview({ durationMonths: 11, amountPaid: 98400 });
    expect(p.unallocated).toBe(8200);
    expect(p.max_recordable).toBe(90200);
    expect(p.coverage.months_covered).toBe(11);
    // No period was invented past the agreement.
    expect(p.allocations.every((a) => !a.rent_month || a.rent_month <= m(2027, 6))).toBe(true);
  });

  it("15. the deposit settles first and is not counted as rent", () => {
    const p = preview({ securityDeposit: 16400, amountPaid: 98400 });
    const deposit = p.allocations.find((a) => a.type === "SECURITY_DEPOSIT");
    expect(deposit?.allocated).toBe(16400);
    // ₹98,400 − ₹16,400 deposit = ₹82,000 = ten months of rent.
    expect(p.coverage.rent_allocated).toBe(82000);
    expect(p.coverage.months_covered).toBe(10);
    expect(iso(p.coverage.paid_through_month)).toBe("2027-05");
  });

  it("15b. with 'includes deposit = No' the deposit stays owed and every rupee is rent", () => {
    const p = preview({ securityDeposit: 16400, amountPaid: 98400, amountIncludesDeposit: false });
    expect(p.allocations.some((a) => a.type === "SECURITY_DEPOSIT")).toBe(false);
    expect(p.coverage.months_covered).toBe(12);
  });

  it("16. onboarding maintenance is settled as maintenance, never as rent, and no future maintenance is invented", () => {
    const p = preview({ maintenanceCharge: 1500, maintenanceType: "ONE_TIME", amountPaid: 1500 + 12 * RENT });
    const maintenance = p.allocations.filter((a) => a.type === "MAINTENANCE");
    expect(maintenance).toHaveLength(1);
    expect(maintenance[0].allocated).toBe(1500);
    expect(p.coverage.rent_allocated).toBe(12 * RENT);
    expect(p.advance_rent_months).toHaveLength(9);
  });

  it("17. a tenant joining next month: advance starts at the joining month, never before it", () => {
    const join = new Date("2026-11-10T00:00:00.000Z");
    const p = preview({ agreementStartDate: join, durationMonths: 3, amountPaid: 3 * RENT });
    expect(p.rent_months).toEqual([]);
    expect(p.advance_rent_months.map(iso)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(p.coverage.current_due).toBe(0);
    expect(iso(p.coverage.paid_through_month)).toBe("2027-01");
  });
});

describe("summarizeRentCoverage", () => {
  it("stops 'paid through' at the first gap even if a later month is paid", () => {
    const c = summarizeRentCoverage(
      [
        { type: "RENT", rent_month: m(2026, 8), outstanding: RENT, allocated: RENT, result: "PAID" },
        { type: "RENT", rent_month: m(2026, 9), outstanding: RENT, allocated: 0, result: "UNCHANGED" },
        { type: "RENT", rent_month: m(2026, 10), outstanding: RENT, allocated: RENT, result: "PAID" },
      ],
      TODAY,
    );
    expect(iso(c.paid_through_month)).toBe("2026-08");
    expect(iso(c.next_due_month)).toBe("2026-09");
    expect(c.months_covered).toBe(2);
  });
});

describe("a tenant who paid upfront before Stayo — ₹75,000 at ₹7,500 from January, added in June", () => {
  const p = buildInviteSettlementPreview({
    monthlyRent: 7500,
    securityDeposit: 0,
    maintenanceCharge: 0,
    maintenanceType: "NONE",
    agreementStartDate: new Date("2026-01-01T00:00:00.000Z"),
    durationMonths: 12,
    dueDay: 5,
    amountPaid: 75000,
    amountIncludesDeposit: true,
    today: new Date("2026-06-10T00:00:00.000Z"),
  });

  it("counts coverage from the rent start date, not from the day Stayo was introduced", () => {
    // Jan–Jun have elapsed and exist; Jul–Oct are created ahead.
    expect(p.rent_months.map(iso)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    expect(p.advance_rent_months.map(iso)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("January–October are paid, June included; paid through October, next rent November", () => {
    expect(p.coverage.months_covered).toBe(10);
    expect(iso(p.coverage.paid_through_month)).toBe("2026-10");
    expect(iso(p.coverage.next_due_month)).toBe("2026-11");
    const june = p.allocations.find((a) => iso(a.rent_month) === "2026-06");
    expect(june?.result).toBe("PAID");
    expect(p.allocations.filter((a) => a.type === "RENT").every((a) => a.result === "PAID")).toBe(true);
  });

  it("nothing is due on the day Stayo is introduced", () => {
    expect(p.coverage.current_due).toBe(0);
    expect(p.remaining_outstanding).toBe(0);
    expect(p.unallocated).toBe(0);
    expect(p.coverage.future_rent_covered).toBe(4 * 7500);
  });

  it("a deposit counted in the same amount is paid first — the owner's answer decides", () => {
    const withDeposit = buildInviteSettlementPreview({
      monthlyRent: 7500, securityDeposit: 15000, maintenanceCharge: 0, maintenanceType: "NONE",
      agreementStartDate: new Date("2026-01-01T00:00:00.000Z"), durationMonths: 12, dueDay: 5,
      amountPaid: 75000, amountIncludesDeposit: true, today: new Date("2026-06-10T00:00:00.000Z"),
    });
    expect(iso(withDeposit.coverage.paid_through_month)).toBe("2026-08"); // 60,000 of rent = 8 months
    const rentOnly = buildInviteSettlementPreview({
      monthlyRent: 7500, securityDeposit: 15000, maintenanceCharge: 0, maintenanceType: "NONE",
      agreementStartDate: new Date("2026-01-01T00:00:00.000Z"), durationMonths: 12, dueDay: 5,
      amountPaid: 75000, amountIncludesDeposit: false, today: new Date("2026-06-10T00:00:00.000Z"),
    });
    expect(iso(rentOnly.coverage.paid_through_month)).toBe("2026-10");
    // "No" keeps the deposit out of where the money goes, not out of what is owed:
    // the deposit is still due now, exactly as the saved tenancy reports it.
    expect(rentOnly.coverage.current_due).toBe(15000);
    expect(withDeposit.coverage.current_due).toBe(0);
  });
});
