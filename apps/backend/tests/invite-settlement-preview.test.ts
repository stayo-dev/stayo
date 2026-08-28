import { describe, expect, it } from "vitest";
import { buildInviteSettlementPreview } from "@/lib/billing/invite-settlement-preview";

const START = new Date("2026-03-15T00:00:00.000Z");
const TODAY_5_MONTHS_IN = new Date("2026-07-20T00:00:00.000Z"); // Mar, Apr, May, Jun, Jul elapsed

function utcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1));
}

describe("buildInviteSettlementPreview", () => {
  it("five elapsed months allocate oldest-first", () => {
    const preview = buildInviteSettlementPreview({
      monthlyRent: 8000,
      securityDeposit: 0,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
      agreementStartDate: START,
      durationMonths: 12,
      dueDay: 5,
      amountPaid: 40000,
      amountIncludesDeposit: true,
      today: TODAY_5_MONTHS_IN,
    });

    expect(preview.rent_months).toEqual([
      utcMonth(2026, 2), // Mar
      utcMonth(2026, 3), // Apr
      utcMonth(2026, 4), // May
      utcMonth(2026, 5), // Jun
      utcMonth(2026, 6), // Jul
    ]);

    expect(preview.allocations).toHaveLength(5);
    // Allocated in ascending rent_month order — oldest obligation settled first.
    const months = preview.allocations.map((a) => a.rent_month?.getTime());
    const sortedMonths = [...months].sort((a, b) => (a as number) - (b as number));
    expect(months).toEqual(sortedMonths);
    expect(preview.allocations[0].rent_month).toEqual(utcMonth(2026, 2));
    expect(preview.allocations[4].rent_month).toEqual(utcMonth(2026, 6));

    for (const alloc of preview.allocations) {
      expect(alloc.allocated).toBe(8000);
      expect(alloc.result).toBe("PAID");
    }
    expect(preview.total_to_settle).toBe(40000);
    expect(preview.remaining_outstanding).toBe(0);
    expect(preview.unallocated).toBe(0);
  });

  it("a partial amount leaves a specific named month short", () => {
    // 4 full months (32000) + 3000 into the 5th (July) — 35000 total.
    const preview = buildInviteSettlementPreview({
      monthlyRent: 8000,
      securityDeposit: 0,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
      agreementStartDate: START,
      durationMonths: 12,
      dueDay: 5,
      amountPaid: 35000,
      amountIncludesDeposit: true,
      today: TODAY_5_MONTHS_IN,
    });

    const july = preview.allocations.find((a) => a.rent_month?.getTime() === utcMonth(2026, 6).getTime());
    expect(july).toBeDefined();
    expect(july!.allocated).toBe(3000);
    expect(july!.amount_due).toBe(8000);
    expect(july!.outstanding - july!.allocated).toBe(5000); // left short by 5000
    expect(july!.result).toBe("PARTIAL");
    expect(july!.label).toContain("Rent");

    const priorMonths = preview.allocations.filter((a) => a.rent_month?.getTime() !== utcMonth(2026, 6).getTime());
    expect(priorMonths).toHaveLength(4);
    for (const alloc of priorMonths) {
      expect(alloc.allocated).toBe(8000);
      expect(alloc.result).toBe("PAID");
    }

    expect(preview.total_to_settle).toBe(35000);
    expect(preview.remaining_outstanding).toBe(5000);
    expect(preview.unallocated).toBe(0);
  });

  it("amountIncludesDeposit: false routes nothing to the deposit", () => {
    const preview = buildInviteSettlementPreview({
      monthlyRent: 8000,
      securityDeposit: 16000,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
      agreementStartDate: START,
      durationMonths: 12,
      dueDay: 5,
      amountPaid: 8000,
      amountIncludesDeposit: false,
      today: TODAY_5_MONTHS_IN,
    });

    // Deposit is excluded from the allocation set entirely — not even as a
    // skipped/unpaid obligation.
    expect(preview.allocations.some((a) => a.type === "SECURITY_DEPOSIT")).toBe(false);
    expect(preview.skipped_obligations.some((s) => s.type === "SECURITY_DEPOSIT")).toBe(false);
    expect(preview.total_outstanding).toBe(5 * 8000); // rent only, deposit never entered the pool

    // The 8000 paid goes to the oldest rent month instead.
    const march = preview.allocations.find((a) => a.rent_month?.getTime() === utcMonth(2026, 2).getTime());
    expect(march!.allocated).toBe(8000);
    expect(march!.result).toBe("PAID");
  });

  it("an amount exceeding everything owed reports the excess rather than over-allocating", () => {
    const preview = buildInviteSettlementPreview({
      monthlyRent: 8000,
      securityDeposit: 16000,
      maintenanceCharge: 1500,
      maintenanceType: "MONTHLY",
      agreementStartDate: START,
      durationMonths: 12,
      dueDay: 5,
      amountPaid: 100000, // total owed = 16000 + 1500 + 5*8000 = 57500
      amountIncludesDeposit: true,
      today: TODAY_5_MONTHS_IN,
    });

    const totalOwed = 16000 + 1500 + 5 * 8000;
    expect(preview.total_outstanding).toBe(totalOwed);
    expect(preview.total_to_settle).toBe(totalOwed);
    expect(preview.remaining_outstanding).toBe(0);
    expect(preview.unallocated).toBe(100000 - totalOwed);

    // No allocation exceeds what was actually due on that obligation.
    for (const alloc of preview.allocations) {
      expect(alloc.allocated).toBeLessThanOrEqual(alloc.amount_due);
      expect(alloc.result).toBe("PAID");
    }
  });

  it("a start date inside the current month behaves like an ordinary new tenancy (one rent month)", () => {
    const today = new Date("2026-08-20T00:00:00.000Z");
    const startInCurrentMonth = new Date("2026-08-05T00:00:00.000Z");

    const preview = buildInviteSettlementPreview({
      monthlyRent: 8000,
      securityDeposit: 0,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
      agreementStartDate: startInCurrentMonth,
      durationMonths: 12,
      dueDay: 5,
      amountPaid: 8000,
      amountIncludesDeposit: true,
      today,
    });

    expect(preview.rent_months).toEqual([utcMonth(2026, 7)]);
    expect(preview.allocations).toHaveLength(1);
    // First (only) month mirrors onboarding-financials-service's exact-start-date rule.
    expect(preview.allocations[0].amount_due).toBe(8000);
    expect(preview.allocations[0].allocated).toBe(8000);
    expect(preview.allocations[0].result).toBe("PAID");
  });

  it("a start date in the future does not invent negative months", () => {
    const today = new Date("2026-08-01T00:00:00.000Z");
    const futureStart = new Date("2026-09-15T00:00:00.000Z");

    const preview = buildInviteSettlementPreview({
      monthlyRent: 8000,
      securityDeposit: 5000,
      maintenanceCharge: 0,
      maintenanceType: "NONE",
      agreementStartDate: futureStart,
      durationMonths: 12,
      dueDay: 5,
      amountPaid: 5000,
      amountIncludesDeposit: true,
      today,
    });

    expect(preview.rent_months).toEqual([]);
    expect(preview.allocations.some((a) => a.type === "RENT")).toBe(false);
    // Deposit is still there and still payable — only the rent schedule is empty.
    expect(preview.allocations.some((a) => a.type === "SECURITY_DEPOSIT")).toBe(true);
  });
});
