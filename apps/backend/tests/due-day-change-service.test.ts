/**
 * Unit tests for applyDueDayChangeInTx — the hostel due-day transition.
 *
 * Exercises the selection + safety rules against a hand-rolled tx mock (same
 * approach as duplicate-rent-prevention.test.ts). The rule mirrors
 * rent-change-service: a future, unpaid, zero-payment obligation may be
 * re-dated in place; everything else is left exactly as billed.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { applyDueDayChangeInTx } from "@/src/services/payments/due-day-change-service";

const HOSTEL_ID = "hostel-1";

function month(y: number, m: number) {
  return new Date(Date.UTC(y, m - 1, 1));
}

function createTx(rows: any[]) {
  return {
    rows,
    rent_obligations: {
      findMany: vi.fn(async ({ where }: any) => {
        return rows.filter((row) => {
          if (where.hostel_id && row.hostel_id !== where.hostel_id) return false;
          if (where.obligation_type?.in && !where.obligation_type.in.includes(row.obligation_type)) return false;
          if (where.is_superseded !== undefined && row.is_superseded !== where.is_superseded) return false;
          if (where.lifecycle_status && row.lifecycle_status !== where.lifecycle_status) return false;
          if (where.settlement_status && row.settlement_status !== where.settlement_status) return false;
          if (where.status?.notIn && where.status.notIn.includes(row.status)) return false;
          if (where.rent_month?.gte && new Date(row.rent_month).getTime() < where.rent_month.gte.getTime()) return false;
          return true;
        });
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...data };
        return rows[idx];
      }),
    },
  };
}

const base = {
  hostel_id: HOSTEL_ID,
  obligation_type: "RENT",
  is_superseded: false,
  lifecycle_status: "ACTIVE",
  settlement_status: "UNPAID",
  status: "UPCOMING",
  payments: [],
};

describe("applyDueDayChangeInTx", () => {
  it("re-dates future unpaid obligations to the new due day", async () => {
    const rows = [
      { ...base, id: "oct", rent_month: month(2026, 10), due_date: new Date(Date.UTC(2026, 9, 5)), billing_period_start: month(2026, 10) },
      { ...base, id: "nov", rent_month: month(2026, 11), due_date: new Date(Date.UTC(2026, 10, 5)), billing_period_start: month(2026, 11) },
    ];
    const tx = createTx(rows);
    const result = await applyDueDayChangeInTx(tx as any, {
      hostelId: HOSTEL_ID,
      newDueDay: 15,
      actorId: "owner-1",
      effectiveFromMonth: month(2026, 10),
    });

    expect(result.obligationsUpdated).toBe(2);
    expect(tx.rows.find((r) => r.id === "oct")!.due_date.getUTCDate()).toBe(15);
    expect(tx.rows.find((r) => r.id === "nov")!.due_date.getUTCDate()).toBe(15);
  });

  it("never touches rows with a recorded payment", async () => {
    const rows = [
      { ...base, id: "paid-partial", status: "PARTIAL", settlement_status: "PARTIAL", rent_month: month(2026, 10), due_date: new Date(Date.UTC(2026, 9, 5)), billing_period_start: month(2026, 10), payments: [{ id: "p1" }] },
      { ...base, id: "zero-payment", rent_month: month(2026, 10), due_date: new Date(Date.UTC(2026, 9, 5)), billing_period_start: month(2026, 10), payments: [{ id: "p2" }] },
    ];
    const tx = createTx(rows);
    const result = await applyDueDayChangeInTx(tx as any, { hostelId: HOSTEL_ID, newDueDay: 20, actorId: "owner-1", effectiveFromMonth: month(2026, 10) });
    expect(result.obligationsUpdated).toBe(0);
  });

  it("skips the joining/first month (period start not the 1st)", async () => {
    const rows = [
      { ...base, id: "joining", rent_month: month(2026, 10), due_date: new Date(Date.UTC(2026, 9, 12)), billing_period_start: new Date(Date.UTC(2026, 9, 12)) },
    ];
    const tx = createTx(rows);
    const result = await applyDueDayChangeInTx(tx as any, { hostelId: HOSTEL_ID, newDueDay: 5, actorId: "owner-1", effectiveFromMonth: month(2026, 10) });
    expect(result.obligationsUpdated).toBe(0);
  });

  it("rejects an out-of-range due day", async () => {
    await expect(
      applyDueDayChangeInTx(createTx([]) as any, { hostelId: HOSTEL_ID, newDueDay: 31, actorId: "owner-1" })
    ).rejects.toThrow(/between 1 and 28/);
  });

  it("is a no-op when the due date is already correct", async () => {
    const rows = [
      { ...base, id: "already", rent_month: month(2026, 10), due_date: new Date(Date.UTC(2026, 9, 10)), billing_period_start: month(2026, 10) },
    ];
    const tx = createTx(rows);
    const result = await applyDueDayChangeInTx(tx as any, { hostelId: HOSTEL_ID, newDueDay: 10, actorId: "owner-1", effectiveFromMonth: month(2026, 10) });
    expect(result.obligationsUpdated).toBe(0);
  });
});
