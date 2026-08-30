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

/**
 * Claiming a tenancy is not starting a new one.
 *
 * Since [[Decisions#ADR-136]] every owner-managed tenancy carries a
 * `profile_id`, so the profile doing the claiming is *already bound to the very
 * tenancy being claimed*. Asking "may this profile start a new tenancy?" then
 * finds that tenancy, sees it live, and refuses — which broke the claim flow
 * for exactly the tenancies it was built to serve. See ADR-153.
 */
describe("evaluateTenancyEligibility — the tenancy being taken over", () => {
  it("does not let a tenancy block its own takeover", () => {
    const claimed = tenancy({ id: "claimed" });
    expect(evaluateTenancyEligibility([claimed], OWNER_A, { ignoreTenancyId: "claimed" })).toEqual({
      eligible: true,
    });
  });

  it("still refuses when the claimant lives somewhere else as well", () => {
    // The guard's real job, and it must survive the fix: someone already
    // living at another hostel cannot take over a second live tenancy.
    const claimed = tenancy({ id: "claimed" });
    const elsewhere = tenancy({ id: "elsewhere", ownerId: OWNER_B, hostelName: "Lakeview" });
    const result = evaluateTenancyEligibility([claimed, elsewhere], OWNER_A, {
      ignoreTenancyId: "claimed",
    });
    expect(result).toMatchObject({ eligible: false, code: "TENANT_HAS_ACTIVE_TENANCY" });
  });

  it("still refuses an unsettled previous stay that is not the claimed one", () => {
    const claimed = tenancy({ id: "claimed" });
    const unsettled = tenancy({
      id: "old",
      status: "FORMER_TENANT",
      wasActivated: true,
      hasCompletedMoveOut: false,
    });
    expect(
      evaluateTenancyEligibility([claimed, unsettled], OWNER_A, { ignoreTenancyId: "claimed" }),
    ).toMatchObject({ eligible: false, code: "PREVIOUS_TENANCY_NOT_SETTLED" });
  });

  it("behaves exactly as before when nothing is ignored", () => {
    // Every existing caller passes no options and must be unaffected.
    const claimed = tenancy({ id: "claimed" });
    expect(evaluateTenancyEligibility([claimed], OWNER_A)).toMatchObject({
      eligible: false,
      code: "TENANT_HAS_ACTIVE_TENANCY",
    });
    expect(evaluateTenancyEligibility([claimed], OWNER_A, {})).toMatchObject({ eligible: false });
  });

  it("ignores an id that matches nothing rather than skipping a real blocker", () => {
    const other = tenancy({ id: "other" });
    expect(
      evaluateTenancyEligibility([other], OWNER_A, { ignoreTenancyId: "not-present" }),
    ).toMatchObject({ eligible: false });
  });
});
