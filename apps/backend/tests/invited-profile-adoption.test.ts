import { describe, expect, it, vi } from "vitest";

// The rule under test is pure, but it shares a file with the resolver that
// reads it — stubbing the client keeps this in the pure suite.
vi.mock("@/lib/db", () => ({ prisma: {}, supabase: {} }));

import { canAdoptByContact } from "@/src/services/tenants/invited-profile-resolver";

const PHONE = "919000000000";
const OTHER = "918111111111";

/**
 * These guard the one genuinely dangerous path in the invitation flow: adopting
 * an existing Stayo account on the strength of contact details an owner typed.
 * Getting it wrong hands someone's login, documents and residency history to
 * whoever holds an invitation link.
 */
describe("adopting an existing account matched only by email", () => {
  it("is allowed when the invitation was sent to that account's verified number", () => {
    expect(canAdoptByContact({ phone: PHONE, phone_verified: true }, PHONE)).toBe(true);
  });

  it("accepts the legacy mobile_verified flag too", () => {
    expect(canAdoptByContact({ phone: PHONE, mobile_verified: true }, PHONE)).toBe(true);
  });

  // The owner-typo case. They meant one address, typed one belonging to a real
  // user, and the phone they typed is the intended person's — so the two
  // contact points disagree and nothing may be adopted.
  it("is refused when the invitation phone is a different number", () => {
    expect(canAdoptByContact({ phone: PHONE, phone_verified: true }, OTHER)).toBe(false);
  });

  it("is refused when the account's number was never verified", () => {
    // An unverified number is itself just something somebody typed, so matching
    // it adds no independent signal.
    expect(canAdoptByContact({ phone: PHONE, phone_verified: false }, PHONE)).toBe(false);
  });

  it("is refused when the account has no number at all", () => {
    // The normal shape of a Google-provisioned account that has never enquired.
    expect(canAdoptByContact({ phone: null, phone_verified: true }, PHONE)).toBe(false);
  });

  it("is refused when the invitation carries no phone", () => {
    expect(canAdoptByContact({ phone: PHONE, phone_verified: true }, null)).toBe(false);
  });

  it("is refused when there is no account", () => {
    expect(canAdoptByContact(null, PHONE)).toBe(false);
  });
});
