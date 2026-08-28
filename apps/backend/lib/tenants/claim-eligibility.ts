import crypto from "crypto";

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
 * `crypto` is fine here — hashing/random-byte generation is CPU-only, no I/O.
 *
 * Why this is security-critical: whoever proves possession of a tenancy's
 * phone number inherits everything hung off `tenant_id` — obligations,
 * payments, receipts, deposit. `isClaimable` decides which tenancies are even
 * reachable this way; `isOtpProofValid` decides what counts as proof. Get
 * either wrong and a stranger can inherit a real person's financial history.
 *
 * SECURITY FIX (final security review, finding 1): `isOtpProofValid` alone
 * binds proof to a *phone number*, not to whoever actually answered the
 * code. Both `lookup` and `confirm` are reachable pre-auth and re-validate a
 * VERIFIED row by phone only — so an attacker who knows the victim's number
 * could poll `lookup` and, the instant the victim verifies, read the
 * tenancy's `tenant_id` and race `confirm` with a password of their own
 * choosing, no session required. `generateClaimProofToken` /
 * `isClaimProofTokenValid` close that: OTP verification (generic across
 * every purpose, `auth-otp-service.ts`) mints a single opaque token exactly
 * when a `CLAIM_OTP_PURPOSE` row flips to VERIFIED, hands the plaintext to
 * the caller once in the verify response, and stores only its hash on that
 * same row (see `CLAIM_TOKEN_HASH_PREFIX`). `lookup` and `confirm` now both
 * require the caller to present that exact token. Because the token lives on
 * the OTP row itself rather than a separate store, it is automatically as
 * single-use and short-lived as the proof already is: once
 * `consumeClaimProof` flips status away from VERIFIED, or once
 * `isOtpProofValid`'s 10-minute window closes, the token stops working too
 * — no separate expiry/consumption bookkeeping needed.
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
  /**
   * Whether the bound profile can sign in — i.e. it has an `auth_user_id`.
   * `false` marks the login-less shell adoption creates, which stays claimable;
   * `true` marks a real account, which does not. Must be supplied whenever
   * `profile_id` is set, or a bound tenancy is refused by default (fail-closed).
   */
  profile_has_login?: boolean;
  /**
   * SECURITY FIX (final security review, finding 2): must be `null` — or
   * already equal to the profile doing the claiming — for a tenancy to be
   * claimable. `startActivation` writes `tenants.profile_id` while leaving
   * `tenants.status` at `INVITED` (a half-activated tenancy someone began
   * and abandoned); Phase 1's `adopt` gates on `status` only, so an owner
   * can adopt that tenancy into `OWNER_MANAGED`/`ACTIVE` with a profile
   * still bound. Without this check, `confirm` would silently overwrite
   * that profile_id with a second claimant's — displacing person A's
   * profile in favor of person B's with no refusal and no audit trail
   * naming A.
   */
  profile_id: string | null;
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
 * - A tenancy whose `profile_id` is already bound to someone else is
 *   excluded (finding 2 above) — `claimingProfileId` lets an authenticated
 *   caller re-confirm a tenancy already bound to *their own* profile
 *   without being refused by this same check.
 */
export function isClaimable(candidate: ClaimCandidateLike, claimingProfileId?: string | null): boolean {
  if (candidate.access_mode !== "OWNER_MANAGED" || candidate.status !== "ACTIVE") return false;
  if (candidate.profile_id == null) return true;
  if (claimingProfileId != null && candidate.profile_id === claimingProfileId) return true;

  // Identity is now centralised: adoption links (or creates) a profile keyed on
  // the canonical phone, so EVERY owner-managed tenancy carries a `profile_id`.
  // Refusing all bound tenancies would therefore refuse every claim.
  //
  // What actually distinguishes "the owner is holding this person's account for
  // them" from "this account belongs to someone who can already sign in" is
  // whether the bound profile has an auth identity. A login-less shell — the
  // exact thing adoption creates — is still claimable by whoever proves the
  // number. A profile that can log in is not, because that would be a takeover.
  return candidate.profile_has_login === false;
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

/**
 * Marks a value stored in `phone_verification_otps.failure_reason` as a
 * claim-proof token hash rather than an ordinary failure message. There is
 * no spare column for this (no migration is being added — see the module
 * comment), and `failure_reason` is the right one to repurpose: it is
 * already free-text, and for a row that reaches `VERIFIED` it is otherwise
 * always null (every other writer only ever sets it on a FAILED/EXPIRED/
 * SKIPPED transition, or explicitly clears it to null on a successful
 * send — see `auth-otp-service.ts`) and is never read again once a row is
 * VERIFIED, except by `isClaimProofTokenValid` below. Only rows with
 * `purpose === CLAIM_OTP_PURPOSE` are ever written this way.
 */
export const CLAIM_TOKEN_HASH_PREFIX = "claim_proof_token_sha256:";

/**
 * Mints a fresh single-use claim-proof token: `token` is returned to the
 * caller exactly once (in the OTP-verify response) and never stored;
 * `storedValue` — the prefixed SHA-256 hash — is written onto the OTP row
 * that was just verified, atomically with the same update that flips it to
 * VERIFIED (see `auth-otp-service.ts`'s `verifyPhoneOtp`).
 */
export function generateClaimProofToken(): { token: string; storedValue: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, storedValue: `${CLAIM_TOKEN_HASH_PREFIX}${hash}` };
}

/**
 * True only when `presentedToken` hashes to the value stored on the OTP
 * row's `failure_reason` column. Used by both `lookup` and `confirm` (via
 * `assertValidClaimProof`) so that presenting a phone number and a fresh OTP
 * code is no longer sufficient on its own — the caller must also hold the
 * token that was handed to whoever actually answered that code. Compares
 * with `crypto.timingSafeEqual` rather than `===` so a mismatched guess
 * cannot be narrowed down by response-time differences.
 */
export function isClaimProofTokenValid(
  storedValue: string | null | undefined,
  presentedToken: string | null | undefined,
): boolean {
  if (!presentedToken || typeof presentedToken !== "string") return false;
  if (!storedValue || !storedValue.startsWith(CLAIM_TOKEN_HASH_PREFIX)) return false;

  const expectedHex = storedValue.slice(CLAIM_TOKEN_HASH_PREFIX.length);
  const presentedHex = crypto.createHash("sha256").update(presentedToken).digest("hex");

  const expected = Buffer.from(expectedHex, "hex");
  const presented = Buffer.from(presentedHex, "hex");
  if (expected.length !== presented.length) return false;
  return crypto.timingSafeEqual(expected, presented);
}
