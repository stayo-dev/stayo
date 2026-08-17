import { describe, it, expect } from "vitest";
import {
  isSettleable,
  groupIntoItems,
  istDayBounds,
} from "@/src/services/settlements/settlement-computation";

const captured = (over: Record<string, unknown> = {}) => ({
  id: "t1", purpose: "TENANT_RENT", status: "CAPTURED",
  amount: 8000, owner_id: "o1", hostel_id: "h1",
  captured_at: new Date("2026-08-16T10:00:00Z"),
  ...over,
});

describe("isSettleable", () => {
  it("settles captured tenant rent — money Stayo is holding for the owner", () => {
    expect(isSettleable(captured())).toBe(true);
  });

  /**
   * The rule the whole feature exists to protect. An owner marking rent as
   * "UPI" produces a payments row but NO gateway transaction — the money went
   * to their own UPI ID. Nothing without a captured transaction reaches here,
   * and anything that does must still be checked.
   */
  it("never settles an owner subscription — that is Stayo's own revenue", () => {
    // Owners pay subscriptions into the SAME account. Settling these would
    // hand Stayo's income straight back and look like generosity.
    expect(isSettleable(captured({ purpose: "OWNER_SUBSCRIPTION" }))).toBe(false);
  });

  it("never settles money that was not captured", () => {
    for (const status of ["AUTHORIZED", "FAILED", "REFUNDED", "PENDING"]) {
      expect(isSettleable(captured({ status }))).toBe(false);
    }
  });

  it("never settles a transaction with no owner to pay", () => {
    expect(isSettleable(captured({ owner_id: null }))).toBe(false);
  });

  it("never settles a zero or negative amount", () => {
    expect(isSettleable(captured({ amount: 0 }))).toBe(false);
    expect(isSettleable(captured({ amount: -500 }))).toBe(false);
  });
});

describe("groupIntoItems", () => {
  it("produces one item per owner, summing their captured rent", () => {
    const items = groupIntoItems([
      captured({ id: "t1", owner_id: "o1", amount: 8000 }),
      captured({ id: "t2", owner_id: "o1", amount: 6500 }),
      captured({ id: "t3", owner_id: "o2", amount: 4000 }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.ownerId === "o1")?.amount).toBe(14500);
    expect(items.find((i) => i.ownerId === "o1")?.transactionIds).toEqual(["t1", "t2"]);
  });

  it("excludes everything unsettleable before summing", () => {
    const items = groupIntoItems([
      captured({ id: "t1", owner_id: "o1", amount: 8000 }),
      captured({ id: "t2", owner_id: "o1", amount: 99999, purpose: "OWNER_SUBSCRIPTION" }),
      captured({ id: "t3", owner_id: "o1", amount: 55555, status: "REFUNDED" }),
    ]);
    // The owner is owed only the rent — not their own subscription payment.
    expect(items).toHaveLength(1);
    expect(items[0].amount).toBe(8000);
    expect(items[0].transactionIds).toEqual(["t1"]);
  });

  it("keeps a per-hostel breakdown, so an owner can reconcile their day", () => {
    const items = groupIntoItems([
      captured({ id: "t1", owner_id: "o1", hostel_id: "hA", amount: 8000 }),
      captured({ id: "t2", owner_id: "o1", hostel_id: "hB", amount: 2000 }),
      captured({ id: "t3", owner_id: "o1", hostel_id: "hA", amount: 1000 }),
    ]);
    expect(items[0].byHostel).toEqual([
      { hostelId: "hA", amount: 9000, count: 2 },
      { hostelId: "hB", amount: 2000, count: 1 },
    ]);
  });

  it("totals reconcile: item amount equals the sum of its transactions", () => {
    const items = groupIntoItems([
      captured({ id: "t1", owner_id: "o1", amount: 3333.33 }),
      captured({ id: "t2", owner_id: "o1", amount: 6666.67 }),
    ]);
    expect(items[0].amount).toBe(10000);
    expect(items[0].paymentCount).toBe(2);
  });

  it("returns nothing for a day with no captured rent, rather than throwing", () => {
    // Before the gateway is live this is the normal case, every night.
    expect(groupIntoItems([])).toEqual([]);
    expect(groupIntoItems([captured({ purpose: "OWNER_SUBSCRIPTION" })])).toEqual([]);
  });

  it("orders owners by amount owed, largest first", () => {
    const items = groupIntoItems([
      captured({ id: "t1", owner_id: "small", amount: 100 }),
      captured({ id: "t2", owner_id: "big", amount: 90000 }),
    ]);
    expect(items.map((i) => i.ownerId)).toEqual(["big", "small"]);
  });
});

describe("istDayBounds", () => {
  it("covers a full IST calendar day", () => {
    const { from, to } = istDayBounds("2026-08-16");
    // IST is UTC+5:30, so the day starts at 18:30 UTC the previous date.
    expect(from.toISOString()).toBe("2026-08-15T18:30:00.000Z");
    expect(to.toISOString()).toBe("2026-08-16T18:30:00.000Z");
  });

  it("is half-open, so a payment can never fall in two runs", () => {
    const day1 = istDayBounds("2026-08-16");
    const day2 = istDayBounds("2026-08-17");
    expect(day1.to.getTime()).toBe(day2.from.getTime());
  });
});
