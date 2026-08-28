import { describe, expect, it } from "vitest";
import {
  CLAIM_OTP_PURPOSE,
  CLAIM_PROOF_MAX_AGE_MS,
  CLAIM_TOKEN_HASH_PREFIX,
  generateClaimProofToken,
  isClaimable,
  isClaimProofTokenValid,
  isOtpProofValid,
  type ClaimCandidateLike,
  type OtpProofLike,
} from "@/lib/tenants/claim-eligibility";

function candidate(overrides: Partial<ClaimCandidateLike> = {}): ClaimCandidateLike {
  return {
    access_mode: "OWNER_MANAGED",
    status: "ACTIVE",
    profile_id: null,
    ...overrides,
  };
}

function proof(overrides: Partial<OtpProofLike> = {}, now: Date): OtpProofLike {
  return {
    status: "VERIFIED",
    purpose: CLAIM_OTP_PURPOSE,
    verified_at: now,
    ...overrides,
  };
}

describe("isClaimable", () => {
  it("is true for an owner-managed, active tenancy", () => {
    expect(isClaimable(candidate())).toBe(true);
  });

  it("rejects a SELF_SERVE tenancy — it already has an identity attached, and claiming it would be an account takeover", () => {
    expect(isClaimable(candidate({ access_mode: "SELF_SERVE" }))).toBe(false);
  });

  it("rejects a FORMER_TENANT tenancy — a past resident must not reopen a closed tenancy via a recycled phone number", () => {
    expect(isClaimable(candidate({ status: "FORMER_TENANT" }))).toBe(false);
  });

  it("rejects a CANCELLED tenancy", () => {
    expect(isClaimable(candidate({ status: "CANCELLED" }))).toBe(false);
  });

  it("rejects an EXPIRED tenancy", () => {
    expect(isClaimable(candidate({ status: "EXPIRED" }))).toBe(false);
  });

  it("rejects an INVITED tenancy — invitation is a separate, still-live flow, not a claim", () => {
    expect(isClaimable(candidate({ status: "INVITED" }))).toBe(false);
  });

  it("rejects OWNER_MANAGED status combined with any non-ACTIVE status, and SELF_SERVE combined with ACTIVE", () => {
    expect(isClaimable(candidate({ access_mode: "SELF_SERVE", status: "ACTIVE" }))).toBe(false);
    expect(isClaimable(candidate({ access_mode: "OWNER_MANAGED", status: "CANCELLED" }))).toBe(false);
  });

  describe("centralised identity: a bound profile is not automatically a real account", () => {
    it("REGRESSION: a tenancy bound to a login-less shell is still claimable", () => {
      // Adoption now links (or creates) a profile keyed on the canonical phone,
      // so EVERY owner-managed tenancy carries a `profile_id`. Refusing all
      // bound tenancies — the previous rule — would refuse every claim and
      // break the entire claim flow.
      expect(
        isClaimable(candidate({ profile_id: "shell-profile", profile_has_login: false }))
      ).toBe(true);
    });

    it("refuses a tenancy bound to a profile that can sign in", () => {
      // That is a real account; claiming it would be a takeover, not onboarding.
      expect(
        isClaimable(candidate({ profile_id: "real-account", profile_has_login: true }))
      ).toBe(false);
    });

    it("fails closed when the login flag is missing on a bound tenancy", () => {
      // A caller that forgets to select `profiles.auth_user_id` must be refused,
      // never waved through on an undefined.
      expect(isClaimable(candidate({ profile_id: "unknown-state" }))).toBe(false);
    });

    it("still lets an authenticated caller re-confirm their own tenancy", () => {
      expect(
        isClaimable(candidate({ profile_id: "mine", profile_has_login: true }), "mine")
      ).toBe(true);
    });
  });

  describe("SECURITY FIX (finding 2): profile_id binding", () => {
    it("accepts an unbound (profile_id: null) tenancy, same as before, with no claiming profile", () => {
      expect(isClaimable(candidate({ profile_id: null }))).toBe(true);
    });

    it("REGRESSION GUARD: rejects a tenancy already bound to a profile when no claiming profile is given (e.g. lookup, pre-auth)", () => {
      expect(isClaimable(candidate({ profile_id: "profile-a", profile_has_login: true }))).toBe(false);
    });

    it("rejects a tenancy bound to a *different* profile than the one attempting to claim it", () => {
      expect(
        isClaimable(candidate({ profile_id: "profile-a", profile_has_login: true }), "profile-b")
      ).toBe(false);
    });

    it("accepts a tenancy already bound to the exact profile attempting to (re-)claim it", () => {
      expect(isClaimable(candidate({ profile_id: "profile-a" }), "profile-a")).toBe(true);
    });

    it("a bound tenancy is still refused regardless of access_mode/status once profile_id mismatches", () => {
      expect(isClaimable(candidate({ profile_id: "profile-a", status: "ACTIVE", access_mode: "OWNER_MANAGED" }))).toBe(false);
    });
  });
});

describe("isOtpProofValid", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");

  it("accepts a fresh, correctly-purposed, verified proof", () => {
    expect(isOtpProofValid(proof({}, now), now)).toBe(true);
  });

  it("SECURITY: rejects a SKIPPED proof — the WhatsApp-unavailable skip path must never count as proof of phone possession, or anyone could claim any tenancy whenever WhatsApp is down", () => {
    expect(isOtpProofValid(proof({ status: "SKIPPED" }, now), now)).toBe(false);
  });

  it("rejects a PENDING proof — the OTP was issued but never verified", () => {
    expect(isOtpProofValid(proof({ status: "PENDING" }, now), now)).toBe(false);
  });

  it("rejects a proof issued for a different purpose, so a code verified for phone-verification or password-reset can never be redirected into a claim", () => {
    expect(isOtpProofValid(proof({ purpose: "PHONE_VERIFICATION" }, now), now)).toBe(false);
    expect(isOtpProofValid(proof({ purpose: "PASSWORD_RESET" }, now), now)).toBe(false);
  });

  it("rejects a proof older than the freshness window", () => {
    const verifiedAt = new Date(now.getTime() - CLAIM_PROOF_MAX_AGE_MS - 1);
    expect(isOtpProofValid(proof({ verified_at: verifiedAt }, now), now)).toBe(false);
  });

  it("accepts a proof exactly at the freshness boundary", () => {
    const verifiedAt = new Date(now.getTime() - CLAIM_PROOF_MAX_AGE_MS);
    expect(isOtpProofValid(proof({ verified_at: verifiedAt }, now), now)).toBe(true);
  });

  it("rejects a proof with a missing verified_at", () => {
    expect(isOtpProofValid(proof({ verified_at: null }, now), now)).toBe(false);
    expect(isOtpProofValid(proof({ verified_at: undefined }, now), now)).toBe(false);
  });

  it("rejects a proof whose verified_at is in the future — clock skew or tampering, never proof", () => {
    const verifiedAt = new Date(now.getTime() + 1000);
    expect(isOtpProofValid(proof({ verified_at: verifiedAt }, now), now)).toBe(false);
  });
});

describe("SECURITY FIX (final security review, finding 1): generateClaimProofToken / isClaimProofTokenValid", () => {
  it("generates a token whose hash validates against the stored value it produced", () => {
    const { token, storedValue } = generateClaimProofToken();
    expect(token.length).toBeGreaterThan(0);
    expect(storedValue.startsWith(CLAIM_TOKEN_HASH_PREFIX)).toBe(true);
    expect(isClaimProofTokenValid(storedValue, token)).toBe(true);
  });

  it("two generated tokens never share a value or a stored hash", () => {
    const a = generateClaimProofToken();
    const b = generateClaimProofToken();
    expect(a.token).not.toBe(b.token);
    expect(a.storedValue).not.toBe(b.storedValue);
  });

  it("SECURITY: rejects the wrong token against a valid stored hash — this is exactly what stops an attacker who only knows the phone number", () => {
    const { storedValue } = generateClaimProofToken();
    expect(isClaimProofTokenValid(storedValue, "attacker-guessed-token")).toBe(false);
  });

  it("rejects a missing/empty presented token", () => {
    const { storedValue } = generateClaimProofToken();
    expect(isClaimProofTokenValid(storedValue, null)).toBe(false);
    expect(isClaimProofTokenValid(storedValue, undefined)).toBe(false);
    expect(isClaimProofTokenValid(storedValue, "")).toBe(false);
  });

  it("rejects when the stored value is absent, null, or an ordinary (non-claim-token) failure_reason — e.g. an OTP row from a different purpose or an unverified row", () => {
    const { token } = generateClaimProofToken();
    expect(isClaimProofTokenValid(null, token)).toBe(false);
    expect(isClaimProofTokenValid(undefined, token)).toBe(false);
    expect(isClaimProofTokenValid("maximum attempts exceeded", token)).toBe(false);
  });

  it("rejects a token from one verification against another verification's stored hash", () => {
    const first = generateClaimProofToken();
    const second = generateClaimProofToken();
    expect(isClaimProofTokenValid(second.storedValue, first.token)).toBe(false);
  });
});
