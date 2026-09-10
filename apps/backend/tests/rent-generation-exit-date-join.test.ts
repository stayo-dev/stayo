import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Rent generation's exit filter and the move-out write path are **two halves of
 * one rule**, in two services, with nothing structural connecting them.
 *
 *   write → `move-out-service.ts` `vacate()`, future-exit branch
 *   read  → `rent-generation-service.ts`, the allocation `whereClause`
 *
 * The future-exit branch deliberately leaves the allocation OPEN
 * (`is_active: true`, `end_date: null`) and the tenant `ACTIVE`, writing only
 * `tenants.exit_date`; `move-out-releases` closes it later. So an exit filter
 * written against `roomAllocation.end_date` alone is satisfied by a departed
 * tenant and bills them for another month — which is exactly what happened
 * (ADR-171 mitigated it by cron ordering, ADR-172 fixed it here).
 *
 * Neither half is wrong on its own, so no single-service test and no type
 * check can catch the drift. This asserts the join, reading source as text —
 * no client, no database — the same approach as
 * `hostel-identity-field-round-trip.test.ts`.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

const moveOutService = read("lib", "services", "move-out-service.ts");
const rentGeneration = read("src", "services", "payments", "rent-generation-service.ts");

/** The `whereClause` object literal that selects allocations to bill. */
const allocationFilter = (() => {
  const start = rentGeneration.indexOf("const whereClause");
  expect(start, "rent-generation-service.ts no longer declares `whereClause`").toBeGreaterThan(-1);
  const end = rentGeneration.indexOf("prisma.roomAllocation.findMany", start);
  expect(end, "`whereClause` is no longer followed by the allocation query").toBeGreaterThan(start);
  return rentGeneration.slice(start, end);
})();

describe("move-out → rent-generation exit join", () => {
  it("still leaves the allocation open on a future-dated exit, which is why the tenant filter is needed", () => {
    // If this branch ever starts closing the allocation, the premise below
    // changes and this whole test should be revisited rather than deleted.
    expect(moveOutService).toContain("const isFutureExit = exitDate.getTime() > now.getTime()");
    expect(moveOutService).toContain("if (!isFutureExit)");
    expect(moveOutService).toMatch(/Future exit: do NOT terminate allocation/);
  });

  it("filters billing on tenants.exit_date, not only on the allocation end_date", () => {
    expect(
      allocationFilter,
      "rent generation must exclude a tenant whose exit_date predates the rent month — " +
        "roomAllocation.end_date is null for a future-dated move-out that move-out-releases " +
        "has not swept yet, so end_date alone bills a departed tenant",
    ).toContain("exit_date");
    expect(allocationFilter).toContain("exit_date: null");
    expect(allocationFilter).toContain("exit_date: { gte: rentMonth }");
  });

  it("keeps the allocation end_date clause as well — the two cover different exit paths", () => {
    // Immediate exits DO close the allocation, and pre-existing closed
    // allocations must stay excluded.
    expect(allocationFilter).toContain("end_date: null");
    expect(allocationFilter).toContain("end_date: { gte: rentMonth }");
  });

  it("bills a mid-month leaver for that month — `gte: rentMonth`, not `gt: now`", () => {
    // Proration is settled at move-out, not by withholding the month's rent.
    // A `gt`/`now` form here would silently change that business rule.
    expect(allocationFilter).not.toContain("exit_date: { gte: now }");
    expect(allocationFilter).not.toContain("exit_date: { gt: now }");
  });
});
