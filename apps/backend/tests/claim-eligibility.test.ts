import { describe, expect, it } from "vitest";
import {
  CLAIM_OTP_PURPOSE,
  CLAIM_PROOF_MAX_AGE_MS,
  isClaimable,
  isOtpProofValid,
  type ClaimCandidateLike,
  type OtpProofLike,
} from "@/lib/tenants/claim-eligibility";

function candidate(overrides: Partial<ClaimCandidateLike> = {}): ClaimCandidateLike {
  return {
    access_mode: "OWNER_MANAGED",
    status: "ACTIVE",
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
