import { describe, expect, it } from "vitest";
import {
  isLiveTenancyStatus,
  selectLiveTenancy,
} from "@/lib/tenancy/live-tenancy";

describe("selectLiveTenancy", () => {
  it("returns null when the profile has never been a tenant", () => {
    expect(selectLiveTenancy([])).toBeNull();
    expect(selectLiveTenancy(null)).toBeNull();
    expect(selectLiveTenancy(undefined)).toBeNull();
  });

  it("returns null when every tenancy has ended", () => {
    expect(
      selectLiveTenancy([
        { id: "a", status: "FORMER_TENANT" },
        { id: "b", status: "EXPIRED" },
      ])
    ).toBeNull();
  });

  it("picks the live tenancy out of a stay history", () => {
    const live = selectLiveTenancy([
      { id: "old", status: "FORMER_TENANT" },
      { id: "current", status: "ACTIVE" },
      { id: "abandoned", status: "CANCELLED" },
    ]);
    expect(live?.id).toBe("current");
  });

  it("treats an INVITED row as live — the seat is taken from acceptance, not activation", () => {
    expect(selectLiveTenancy([{ id: "pending", status: "INVITED" }])?.id).toBe("pending");
  });

  it("throws rather than guessing when two tenancies are live", () => {
    // Only reachable if the partial unique index is missing. Picking either one
    // would silently attach a tenant's money to the wrong hostel.
    expect(() =>
      selectLiveTenancy([
        { id: "one", status: "ACTIVE" },
        { id: "two", status: "INVITED" },
      ])
    ).toThrow(/INVARIANT_VIOLATION/);
  });
});

describe("isLiveTenancyStatus", () => {
  it("matches the statuses migration 062's index covers", () => {
    expect(isLiveTenancyStatus("INVITED")).toBe(true);
    expect(isLiveTenancyStatus("ACTIVE")).toBe(true);
    expect(isLiveTenancyStatus("FORMER_TENANT")).toBe(false);
    expect(isLiveTenancyStatus(null)).toBe(false);
  });
});
