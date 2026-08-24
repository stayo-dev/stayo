import { describe, expect, it } from "vitest";
import { isPhoneAlreadyProven } from "@/src/services/tenants/invitation-phone-trust";

const PHONE = "919000000000";
const OTHER = "918111111111";

/** Nothing proven by anything — the shape an owner-typed walk-in invite has. */
function base(overrides: Partial<Parameters<typeof isPhoneAlreadyProven>[0]> = {}) {
  return {
    submittedPhone: PHONE,
    profile: null,
    tenant: null,
    invitationPhone: PHONE,
    whatsappDeliveredAt: null,
    ...overrides,
  };
}

describe("a number already verified on the linked account", () => {
  // This is the Stayo Discover seeker: they OTP-verified at enquiry time, long
  // before any owner invited them. Their proof is independent of how the
  // invitation travelled, which is why the delivery column is not needed here.
  it("is trusted regardless of how the invitation was delivered", () => {
    expect(
      isPhoneAlreadyProven(
        base({
          profile: { phone: PHONE, phone_verified: true },
          whatsappDeliveredAt: null,
        }),
      ),
    ).toBe(true);
  });

  it("accepts the legacy mobile_verified flag as well as phone_verified", () => {
    expect(
      isPhoneAlreadyProven(base({ profile: { phone: PHONE, mobile_verified: true } })),
    ).toBe(true);
  });

  it("accepts verification recorded on the tenancy rather than the account", () => {
    expect(
      isPhoneAlreadyProven(base({ tenant: { phone_1: PHONE, mobile_verified: true } })),
    ).toBe(true);
  });

  it("does not carry the proof across to a different number", () => {
    // The account verified PHONE; they are now submitting OTHER. Verifying one
    // number says nothing about another.
    expect(
      isPhoneAlreadyProven(
        base({ submittedPhone: OTHER, profile: { phone: PHONE, phone_verified: true } }),
      ),
    ).toBe(false);
  });

  it("does not trust a number merely present on an unverified account", () => {
    expect(
      isPhoneAlreadyProven(base({ profile: { phone: PHONE, phone_verified: false } })),
    ).toBe(false);
  });
});

describe("a number the invitation link was delivered to", () => {
  it("is trusted when WhatsApp delivered to exactly that number", () => {
    expect(
      isPhoneAlreadyProven(base({ whatsappDeliveredAt: new Date("2026-08-25T09:00:00Z") })),
    ).toBe(true);
  });

  it("is not trusted once the invitee edits it to a different number", () => {
    // The rule that makes editing cost an OTP: delivery vouches only for the
    // number it was actually sent to.
    expect(
      isPhoneAlreadyProven(
        base({ submittedPhone: OTHER, whatsappDeliveredAt: new Date() }),
      ),
    ).toBe(false);
  });
});

describe("the fallback and every other uncertain path", () => {
  // The whole point of recording only success: none of these need their own
  // branch, and none of them can silently become trusted later.
  it("is untrusted when WhatsApp failed and the link went out by email", () => {
    expect(isPhoneAlreadyProven(base({ whatsappDeliveredAt: null }))).toBe(false);
  });

  it("is untrusted for an invitation created before delivery was recorded", () => {
    expect(isPhoneAlreadyProven(base({ whatsappDeliveredAt: null }))).toBe(false);
  });

  it("is untrusted when the invitation carries no phone at all", () => {
    expect(
      isPhoneAlreadyProven(base({ invitationPhone: null, whatsappDeliveredAt: new Date() })),
    ).toBe(false);
  });

  it("refuses an empty submitted number outright", () => {
    expect(
      isPhoneAlreadyProven(
        base({ submittedPhone: "", profile: { phone: "", phone_verified: true } }),
      ),
    ).toBe(false);
  });
});
