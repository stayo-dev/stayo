/**
 * Pure rules for "may this tenancy be claimed?" and "does this OTP proof
 * actually establish possession of the phone number?".
 *
 * Kept free of Prisma and every other I/O — the service layer
 * (`tenancy-claim-service.ts`, Task 2) does the querying and hands plain data
 * in here. This module is deliberately narrow: it knows nothing about phone
 * formats (`lib/utils/phone-utils.ts` owns that, and imports prisma at module
 * scope, so pulling it in here would drag a database import into a module
 * that must stay pure) — only about tenancy statuses and OTP-proof shape.
 *
 * Why this is security-critical: whoever proves possession of a tenancy's
 * phone number inherits everything hung off `tenant_id` — obligations,
 * payments, receipts, deposit. `isClaimable` decides which tenancies are even
 * reachable this way; `isOtpProofValid` decides what counts as proof. Get
 * either wrong and a stranger can inherit a real person's financial history.
 */

/**
 * The OTP purpose reserved for the claim flow. A code issued for this
 * purpose can only ever be redeemed as claim proof — never accepted as proof
 * for phone-verification, password-reset, or any other flow that reuses the
 * `phone_verification_otps` table, and vice versa.
 */
export const CLAIM_OTP_PURPOSE = "TENANCY_CLAIM";

/**
 * How long a VERIFIED claim-purpose OTP proof stays usable after
 * verification, in milliseconds. Chosen as 10 minutes: the claim flow is
 * lookup → picker/confirmation card → confirm, spanning more than one
 * request, so the window needs enough slack for a person to read the
 * confirmation card before confirming. It is deliberately short — twice the
 * OTP entry window itself (5 minutes, `OTP_TTL_MS` in
 * `lib/services/auth/auth-otp-service.ts`) — so a verified-but-unused proof
 * cannot sit around as a long-lived, silently reusable credential.
 */
export const CLAIM_PROOF_MAX_AGE_MS = 10 * 60 * 1000;

/** The subset of a tenancy's fields `isClaimable` needs. */
export interface ClaimCandidateLike {
  /** `TenantAccessMode` — only `"OWNER_MANAGED"` tenancies are claimable. */
  access_mode: string;
  /** `TenantStatus` — only `"ACTIVE"` tenancies are claimable. */
  status: string;
}

/** The subset of a `phone_verification_otps` row `isOtpProofValid` needs. */
export interface OtpProofLike {
  /**
   * Must be exactly `"VERIFIED"`. In particular, `"SKIPPED"` — written when
   * WhatsApp is unavailable and `sendPhoneOtp` returns
   * `verification_required: false` — is never proof, and neither is
   * `"PENDING"`, `"EXPIRED"`, or `"FAILED"`.
   */
  status: string;
  /** Must equal `CLAIM_OTP_PURPOSE` exactly. */
  purpose: string;
  /** When the row was verified. Absent/null means no verification occurred. */
  verified_at: Date | string | null | undefined;
}

/**
 * True only for a tenancy an owner has been managing on the tenant's behalf,
 * still in its live, active state.
 *
 * - `SELF_SERVE` is excluded: it already has an identity attached (whether
 *   from signup or an earlier claim), so "claiming" it again would be an
 *   account takeover, not onboarding.
 * - `FORMER_TENANT`, `CANCELLED`, `EXPIRED` are excluded: a past resident
 *   must not be able to reopen a closed tenancy by re-verifying a phone
 *   number, and numbers get recycled to new subscribers over time.
 * - `INVITED` is excluded: that tenancy has its own live flow (accepting the
 *   invitation), not a claim.
 */
export function isClaimable(candidate: ClaimCandidateLike): boolean {
  return candidate.access_mode === "OWNER_MANAGED" && candidate.status === "ACTIVE";
}

/**
 * True only when every one of these holds:
 *  - the proof's status is exactly `"VERIFIED"` (never `"SKIPPED"` — see the
 *    module comment on `OtpProofLike.status` — and never `"PENDING"`);
 *  - the proof's purpose is exactly `CLAIM_OTP_PURPOSE`, so a code verified
 *    for a different flow can never be redirected into a claim;
 *  - `verified_at` is present, not in the future, and no older than
 *    `CLAIM_PROOF_MAX_AGE_MS` relative to `now`.
 */
export function isOtpProofValid(proof: OtpProofLike, now: Date): boolean {
  if (proof.status !== "VERIFIED") return false;
  if (proof.purpose !== CLAIM_OTP_PURPOSE) return false;
  if (!proof.verified_at) return false;

  const verifiedAt = new Date(proof.verified_at);
  if (Number.isNaN(verifiedAt.getTime())) return false;

  const ageMs = now.getTime() - verifiedAt.getTime();
  if (ageMs < 0) return false;
  if (ageMs > CLAIM_PROOF_MAX_AGE_MS) return false;

  return true;
}
