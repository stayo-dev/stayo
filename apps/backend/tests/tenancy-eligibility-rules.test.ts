import { describe, expect, it } from "vitest";
import {
  evaluateTenancyEligibility,
  isLiveTenancy,
  type TenancySnapshot,
} from "@/src/services/tenants/tenancy-eligibility-rules";

const OWNER_A = "owner-a";
const OWNER_B = "owner-b";

function tenancy(overrides: Partial<TenancySnapshot> = {}): TenancySnapshot {
  return {
    id: "tenancy-1",
    status: "ACTIVE",
    ownerId: OWNER_A,
    hostelName: "Sunrise Residency",
    roomNumber: "204",
    wasActivated: true,
    hasCompletedMoveOut: false,
    ...overrides,
  };
}

describe("isLiveTenancy", () => {
  it("treats INVITED and ACTIVE as live", () => {
    expect(isLiveTenancy({ status: "INVITED" })).toBe(true);
    expect(isLiveTenancy({ status: "ACTIVE" })).toBe(true);
  });

  it("treats ended tenancies as not live", () => {
    for (const status of ["FORMER_TENANT", "EXPIRED", "CANCELLED"]) {
      expect(isLiveTenancy({ status })).toBe(false);
    }
  });
});

describe("evaluateTenancyEligibility", () => {
  it("lets a person with no tenancy history join", () => {
    expect(evaluateTenancyEligibility([], OWNER_A)).toEqual({ eligible: true });
  });

  it("blocks someone who already holds a live tenancy", () => {
    const result = evaluateTenancyEligibility([tenancy()], OWNER_B);
    expect(result.eligible).toBe(false);
    expect(result).toMatchObject({ code: "TENANT_HAS_ACTIVE_TENANCY" });
  });

  it("blocks someone who has accepted an invitation but not yet activated", () => {
    const result = evaluateTenancyEligibility(
      [tenancy({ status: "INVITED", wasActivated: false })],
      OWNER_B
    );
    expect(result).toMatchObject({ code: "TENANT_HAS_ACTIVE_TENANCY" });
  });

  it("blocks a moved-out tenant whose settlement is not COMPLETED", () => {
    const result = evaluateTenancyEligibility(
      [tenancy({ status: "FORMER_TENANT", hasCompletedMoveOut: false })],
      OWNER_B
    );
    expect(result).toMatchObject({ code: "PREVIOUS_TENANCY_NOT_SETTLED" });
  });

  it("lets a moved-out tenant join once settlement is COMPLETED", () => {
    const result = evaluateTenancyEligibility(
      [tenancy({ status: "FORMER_TENANT", hasCompletedMoveOut: true })],
      OWNER_B
    );
    expect(result).toEqual({ eligible: true });
  });

  it("ignores an invitation that expired before the tenant ever moved in", () => {
    // No settlement can be owed for a stay that never happened, so this must not
    // trap the person on the platform forever.
    const result = evaluateTenancyEligibility(
      [tenancy({ status: "EXPIRED", wasActivated: false, hasCompletedMoveOut: false })],
      OWNER_B
    );
    expect(result).toEqual({ eligible: true });
  });

  it("ignores a cancelled invitation that never activated", () => {
    const result = evaluateTenancyEligibility(
      [tenancy({ status: "CANCELLED", wasActivated: false, hasCompletedMoveOut: false })],
      OWNER_B
    );
    expect(result).toEqual({ eligible: true });
  });

  it("requires every past stay to be settled, not just the most recent", () => {
    const result = evaluateTenancyEligibility(
      [
        tenancy({ id: "old", status: "FORMER_TENANT", hasCompletedMoveOut: false }),
        tenancy({ id: "recent", status: "FORMER_TENANT", hasCompletedMoveOut: true }),
      ],
      OWNER_B
    );
    expect(result).toMatchObject({ code: "PREVIOUS_TENANCY_NOT_SETTLED" });
  });

  describe("disclosure", () => {
    it("names the hostel when the tenant already lives with the asking owner", () => {
      const result = evaluateTenancyEligibility([tenancy({ ownerId: OWNER_A })], OWNER_A);
      expect(result).toMatchObject({
        disclosure: {
          scope: "OWN",
          hostelName: "Sunrise Residency",
          roomNumber: "204",
          tenantId: "tenancy-1",
        },
      });
    });

    it("reveals nothing about another owner's property", () => {
      const result = evaluateTenancyEligibility([tenancy({ ownerId: OWNER_A })], OWNER_B);
      expect(result).toMatchObject({
        disclosure: { scope: "OTHER", hostelName: null, roomNumber: null, tenantId: null },
      });
    });

    it("reveals nothing when the asking owner is unknown", () => {
      const result = evaluateTenancyEligibility([tenancy({ ownerId: OWNER_A })], null);
      expect(result).toMatchObject({ disclosure: { scope: "OTHER", hostelName: null } });
    });

    it("does not leak another owner's hostel through the unsettled-stay refusal", () => {
      const result = evaluateTenancyEligibility(
        [tenancy({ status: "FORMER_TENANT", ownerId: OWNER_A, hasCompletedMoveOut: false })],
        OWNER_B
      );
      expect(result).toMatchObject({
        code: "PREVIOUS_TENANCY_NOT_SETTLED",
        disclosure: { scope: "OTHER", hostelName: null, roomNumber: null, tenantId: null },
      });
    });
  });
});
