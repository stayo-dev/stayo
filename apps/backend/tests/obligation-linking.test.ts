import { describe, it, expect } from "vitest";
import { planObligationLinking, type LinkableObligation } from "@/src/services/tenants/obligation-linking";

const ALLOC = "alloc-1";

const ob = (
  id: string,
  rent_month: string,
  obligation_type = "RENT",
  allocation_id: string | null = null,
): LinkableObligation => ({ id, rent_month, obligation_type, allocation_id });

/**
 * The rule behind a real production defect: a tenant adopted mid-year was
 * billed twice for the current month, because the backfilled obligations were
 * written before the allocation existed and every duplicate guard downstream is
 * allocation-scoped. See ADR-149.
 */
describe("planObligationLinking", () => {
  it("binds the orphaned months an adoption backfilled", () => {
    const plan = planObligationLinking(
      [ob("a", "2026-02-01"), ob("b", "2026-03-01"), ob("c", "2026-04-01")],
      ALLOC,
    );
    expect(plan.link).toEqual(["a", "b", "c"]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves obligations that already belong to the allocation alone", () => {
    const plan = planObligationLinking([ob("a", "2026-02-01", "RENT", ALLOC)], ALLOC);
    expect(plan.link).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("refuses to bind an orphan whose month is already covered, rather than colliding", () => {
    // The exact production shape: two RENT rows for 2026-08, one allocated and
    // one not. Binding the orphan would violate the unique index and fail the
    // whole invitation, so it is reported instead.
    const plan = planObligationLinking(
      [ob("allocated", "2026-08-01", "RENT", ALLOC), ob("orphan", "2026-08-01")],
      ALLOC,
    );
    expect(plan.link).toEqual([]);
    expect(plan.skipped).toEqual(["orphan"]);
  });

  it("tells two obligation types for the same month apart", () => {
    const plan = planObligationLinking(
      [ob("rent", "2026-02-01", "RENT"), ob("deposit", "2026-02-01", "SECURITY_DEPOSIT")],
      ALLOC,
    );
    expect(plan.link).toEqual(["rent", "deposit"]);
  });

  it("never links two orphans onto the same slot", () => {
    // Otherwise the fix would create the very collision it exists to prevent.
    const plan = planObligationLinking([ob("first", "2026-08-01"), ob("second", "2026-08-01")], ALLOC);
    expect(plan.link).toEqual(["first"]);
    expect(plan.skipped).toEqual(["second"]);
  });

  it("ignores obligations bound to some other allocation", () => {
    // A previous tenancy in another room is not this allocation's business,
    // and must not be re-pointed at it.
    const plan = planObligationLinking([ob("other", "2026-02-01", "RENT", "alloc-9")], ALLOC);
    expect(plan.link).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("does not treat another allocation's month as taken", () => {
    const plan = planObligationLinking(
      [ob("other", "2026-02-01", "RENT", "alloc-9"), ob("orphan", "2026-02-01")],
      ALLOC,
    );
    expect(plan.link).toEqual(["orphan"]);
  });

  it("compares months by date, not by how the value was typed", () => {
    const plan = planObligationLinking(
      [
        { id: "allocated", allocation_id: ALLOC, obligation_type: "RENT", rent_month: new Date("2026-08-01T00:00:00.000Z") },
        ob("orphan", "2026-08-01T00:00:00.000Z"),
      ],
      ALLOC,
    );
    expect(plan.skipped).toEqual(["orphan"]);
  });

  it("survives an empty or missing list", () => {
    expect(planObligationLinking([], ALLOC)).toEqual({ link: [], skipped: [] });
    expect(planObligationLinking(undefined as any, ALLOC)).toEqual({ link: [], skipped: [] });
  });
});
