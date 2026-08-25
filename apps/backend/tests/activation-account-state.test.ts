import { describe, expect, it } from "vitest";
import { isAccountSetupComplete } from "@/src/services/tenants/activation-account-state";

/** A Discover seeker: real account, phone verified at enquiry time. */
const SEEKER = { phone: "7013216327", phone_verified: true, mobile_verified: true };

describe("account setup is not complete until the tenancy is bound", () => {
  // The 2026-08-25 production regression, pinned. The tenancy was matched to a
  // real account whose number was verified long before the invitation existed,
  // and this reported "done" — so the wizard skipped ACCOUNT, nothing ever wrote
  // `tenants.profile_id`, and activation failed with "Activation link expired or
  // already used" on a link that was perfectly valid.
  it("is false for an unbound tenancy, however verified the matched account is", () => {
    expect(
      isAccountSetupComplete({
        tenant: { profile_id: null, phone_1: "+917013216327", mobile_verified: false },
        profile: SEEKER,
      }),
    ).toBe(false);
  });

  it("becomes true once the tenancy names the account", () => {
    expect(
      isAccountSetupComplete({
        tenant: { profile_id: "p1", phone_1: "+917013216327", mobile_verified: false },
        profile: SEEKER,
      }),
    ).toBe(true);
  });

  it("is false when nothing has verified a number", () => {
    expect(
      isAccountSetupComplete({
        tenant: { profile_id: "p1", phone_1: "+917013216327", mobile_verified: false },
        profile: { phone: "7013216327", phone_verified: false, mobile_verified: false },
      }),
    ).toBe(false);
  });

  it("accepts verification recorded on the tenancy rather than the account", () => {
    // The owner-typed walk-in path: no prior account, `saveAccount` sets
    // `mobile_verified` on the tenancy after the OTP.
    expect(
      isAccountSetupComplete({
        tenant: { profile_id: "p1", phone_1: "+917013216327", mobile_verified: true },
        profile: null,
      }),
    ).toBe(true);
  });

  it("needs a number on file as well as a verification flag", () => {
    expect(
      isAccountSetupComplete({
        tenant: { profile_id: "p1", phone_1: null, mobile_verified: true },
        profile: { phone: null, phone_verified: true },
      }),
    ).toBe(false);
  });

  it("is false when there is no tenancy at all", () => {
    expect(isAccountSetupComplete({ tenant: null, profile: SEEKER })).toBe(false);
  });
});
