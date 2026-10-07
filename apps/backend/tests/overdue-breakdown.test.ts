import { describe, expect, it } from "vitest";
import { computeOverdueBreakdown } from "@/src/services/payments/overdue-breakdown";

const now = new Date("2026-10-07T00:00:00Z");
const rent = (month: string, status = "PENDING", paid = 0, amount = 8000) => ({
  amount,
  status,
  obligation_type: "RENT",
  rent_month: new Date(`${month}-01T00:00:00Z`),
  due_date: new Date(`${month}-05T00:00:00Z`),
  payments: paid ? [{ amount_paid: paid }] : [],
});

describe("computeOverdueBreakdown", () => {
  it("counts each unpaid past-due rent month once", () => {
    const result = computeOverdueBreakdown([rent("2026-08"), rent("2026-09"), rent("2026-10")], now);
    expect(result).toEqual({ overdue_amount: 24000, overdue_rent_count: 3 });
  });

  it("ignores rent not yet due, paid, and waived", () => {
    const result = computeOverdueBreakdown(
      [rent("2026-09", "PAID", 8000), rent("2026-08", "WAIVED"), rent("2026-11"), rent("2026-10")],
      now,
    );
    expect(result).toEqual({ overdue_amount: 8000, overdue_rent_count: 1 });
  });

  it("counts a partly paid month, for the remaining balance only", () => {
    const result = computeOverdueBreakdown([rent("2026-09", "PARTIAL", 5000)], now);
    expect(result).toEqual({ overdue_amount: 3000, overdue_rent_count: 1 });
  });

  it("adds overdue deposits to the amount but not to the rent count", () => {
    const deposit = { ...rent("2026-08"), obligation_type: "SECURITY_DEPOSIT", amount: 16000 };
    expect(computeOverdueBreakdown([deposit], now)).toEqual({ overdue_amount: 16000, overdue_rent_count: 0 });
  });

  it("treats a fully paid row with a stale PENDING status as settled", () => {
    expect(computeOverdueBreakdown([rent("2026-09", "PENDING", 8000)], now)).toEqual({
      overdue_amount: 0,
      overdue_rent_count: 0,
    });
  });
});
