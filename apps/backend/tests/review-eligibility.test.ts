import { describe, it, expect } from "vitest";
import { reviewEligibility } from "@/src/services/discovery/review-eligibility";

describe("reviewEligibility", () => {
  it("lets a current resident review the hostel they live in", () => {
    expect(reviewEligibility({ signedIn: true, tenancyStatuses: ["ACTIVE"] }))
      .toEqual({ canReview: true, tenancy: "ACTIVE" });
  });

  it("lets a former resident review it too", () => {
    // The most useful reviews come from people whose stay has finished.
    expect(reviewEligibility({ signedIn: true, tenancyStatuses: ["FORMER_TENANT"] }))
      .toEqual({ canReview: true, tenancy: "FORMER" });
  });

  it("refuses a signed-in account with no tenancy here", () => {
    // The whole point of the change: an account is not an experience.
    expect(reviewEligibility({ signedIn: true, tenancyStatuses: [] }))
      .toEqual({ canReview: false, reason: "NOT_A_RESIDENT" });
  });

  it("refuses an invitation that was never taken up", () => {
    // INVITED has never spent a night in the building; CANCELLED and EXPIRED
    // are invitations that fell through.
    for (const status of ["INVITED", "CANCELLED", "EXPIRED"]) {
      expect(reviewEligibility({ signedIn: true, tenancyStatuses: [status] }))
        .toEqual({ canReview: false, reason: "NOT_A_RESIDENT" });
    }
  });

  it("accepts a real tenancy alongside a cancelled one", () => {
    // Someone re-invited after a cancelled invite still lived here.
    expect(reviewEligibility({ signedIn: true, tenancyStatuses: ["CANCELLED", "ACTIVE"] }).canReview).toBe(true);
  });

  it("prefers ACTIVE when the account holds both", () => {
    expect(reviewEligibility({ signedIn: true, tenancyStatuses: ["FORMER_TENANT", "ACTIVE"] }))
      .toEqual({ canReview: true, tenancy: "ACTIVE" });
  });

  it("distinguishes signed out from not-a-resident", () => {
    // They need different sentences: one is "sign in", the other is "only
    // residents can review".
    expect(reviewEligibility({ signedIn: false, tenancyStatuses: ["ACTIVE"] }))
      .toEqual({ canReview: false, reason: "SIGNED_OUT" });
  });

  it("is case-insensitive about status", () => {
    expect(reviewEligibility({ signedIn: true, tenancyStatuses: ["active"] }).canReview).toBe(true);
  });
});
