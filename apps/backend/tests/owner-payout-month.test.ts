import { describe, it, expect } from "vitest";
import { assembleMonth } from "@/src/services/settlements/owner-payout-month";

/**
 * The month block is the thing an owner checks against his own notebook. If it
 * does not add up he trusts the notebook, and the notebook wins forever.
 */
describe("assembleMonth", () => {
  const base = {
    monthLabel: "August",
    direct: 41200,
    inYourBank: 64300,
    withStayo: 18500,
    stillToCollect: 32400,
    tenantsOwing: 6,
  };

  it("derives the totals from their parts so they cannot disagree", () => {
    const block = assembleMonth(base);
    expect(block.throughStayo).toBe(64300 + 18500);
    expect(block.collected).toBe(41200 + 64300 + 18500);
  });

  it("keeps money the owner already holds out of what Stayo owes", () => {
    const block = assembleMonth(base);
    // `direct` is cash and owner-UPI. It appears in `collected` and nowhere
    // near `throughStayo` — mixing them once makes every later number suspect.
    expect(block.throughStayo).toBe(82800);
    expect(block.direct).toBe(41200);
  });

  it("does not lose rupees to floating point", () => {
    const block = assembleMonth({ ...base, direct: 0.1, inYourBank: 0.2, withStayo: 0 });
    expect(block.collected).toBe(0.3);
  });

  it("clamps a negative sum instead of quietly shrinking the total", () => {
    // A negative here is a data fault. A visible zero can be investigated; a
    // plausible-but-wrong total cannot.
    const block = assembleMonth({ ...base, withStayo: -5000 });
    expect(block.withStayo).toBe(0);
    expect(block.throughStayo).toBe(64300);
  });

  it("survives a missing figure without producing NaN on a money screen", () => {
    const block = assembleMonth({ ...base, direct: NaN as unknown as number });
    expect(block.direct).toBe(0);
    expect(Number.isFinite(block.collected)).toBe(true);
  });

  it("reports a whole number of tenants owing", () => {
    expect(assembleMonth({ ...base, tenantsOwing: 6.7 }).tenantsOwing).toBe(6);
    expect(assembleMonth({ ...base, tenantsOwing: -3 }).tenantsOwing).toBe(0);
  });
});
