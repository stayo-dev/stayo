import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { eventLog } from "@/lib/services/event-log-service";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { resolveTenantName } from "@/lib/tenants/tenant-identity";
import {
  CLAIM_OTP_PURPOSE,
  isClaimable,
  isClaimProofTokenValid,
  isOtpProofValid,
} from "@/lib/tenants/claim-eligibility";
import { hashPassword } from "@/lib/auth";
import { getActiveTenancy } from "@/lib/tenancy/active-tenancy";
import {
  getActiveTemplateAndSyncRuleVersion,
  interpolateRulesContent,
  DEFAULT_AGREEMENT_TEMPLATE,
} from "@/utils/default-rules";
import { hasCompletedActivation } from "./activation-entry";
import { resolveActivationEmail } from "./invited-profile-resolver";
import { tenancyEligibilityService } from "./tenancy-eligibility-service";
import { notificationService } from "@/lib/services/notification-service";
import { financialService } from "../payments/financial-service";

const logger = getLogger("services.tenancy-claim");

/**
 * Mirrors `REQUIRED_ACKNOWLEDGEMENTS` in `activation-workflow-service.ts`
 * (`acceptRules`'s gate). Kept as a local copy rather than an import — that
 * file is a large class-based service and this module intentionally stays
 * decoupled from it — but the two lists must be changed together; if
 * activation ever adds/removes a required acknowledgement, mirror it here.
 */
export const REQUIRED_ACKNOWLEDGEMENTS = [
  "fee_refund_rules",
  "discipline_policies",
  "late_fee_obligations",
  "damage_liabilities",
  "hostel_rules",
] as const;

/**
 * Claiming a tenancy an owner has been keeping the books for: a tenant who
 * never touched the app proves possession of the phone number on the
 * tenancy, and the tenancy flips `OWNER_MANAGED → SELF_SERVE` in place —
 * same `tenant_id`, so every obligation, payment and receipt already on the
 * record survives untouched.
 *
 * ## Why this is security-critical
 *
 * Whoever proves possession of a tenancy's phone number inherits everything
 * hung off `tenant_id` — obligations, payments, receipts, deposit. Three
 * rules hold everywhere in this file:
 *
 * 1. **The OTP skip path is never proof.** `authOtpService.sendPhoneOtp`
 *    writes a `phoneVerificationOtp` row with `status: "SKIPPED"` (never
 *    `"VERIFIED"`) when WhatsApp is unavailable — see
 *    `lib/services/auth/auth-otp-service.ts`. `isOtpProofValid` (imported,
 *    not reimplemented) rejects anything but a fresh `"VERIFIED"` row for
 *    `CLAIM_OTP_PURPOSE`. Both `lookup` and `confirm` re-run this check from
 *    scratch against the database — `confirm` never trusts that `lookup` ran,
 *    and neither ever trusts a client-supplied "verified" flag.
 * 2. **`lookup` returns display data only.** It is reachable
 *    pre-authentication by anyone holding a verified number, so a mistyped
 *    digit must never expose a stranger's finances — no obligations, no
 *    balances, no payment history, ever, from this file.
 * 3. **A claim never overwrites an existing account's credentials.** When
 *    the unauthenticated path matches an *existing* profile by phone
 *    (`assertClaimablePhoneMatch`), a `password_hash` already on it is left
 *    untouched — Indian numbers get recycled, so "the same phone" is not
 *    reliably "the same person," and even when it is, a marketplace user who
 *    already set a password must not have it silently reset by whoever next
 *    proves the number over OTP. That claimant is refused with
 *    `SIGN_IN_REQUIRED` and must authenticate first, after which the
 *    already-signed-in `profileId` path (which never accepts a password)
 *    handles the claim.
 */

export class TenancyClaimError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "TenancyClaimError";
  }
}

const CLAIM_PHONE_LIMIT = 10;
const CLAIM_PHONE_WINDOW_SECONDS = 15 * 60;
const CLAIM_IP_LIMIT = 30;
const CLAIM_IP_WINDOW_SECONDS = 60 * 60;

/**
 * Per-phone and per-IP fixed-window limits, in the idiom of
 * `AuthOtpService.enforceSendRateLimits`. Deliberately without that method's
 * database fallback: there is no natural DB-backed count for "claim attempts"
 * the way `phoneVerificationOtp` rows serve OTP sends, so — like the rest of
 * this codebase's Redis-backed limits — this fails open (allows the request)
 * when Redis is unavailable rather than failing closed.
 */
async function enforceClaimRateLimits(scope: "lookup" | "confirm", phone: string, requestIp: string | null | undefined) {
  const phoneLimit = await checkFixedWindowLimit({
    scope: `tenancy-claim:${scope}:phone`,
    identifier: phone,
    maxAttempts: CLAIM_PHONE_LIMIT,
    windowSeconds: CLAIM_PHONE_WINDOW_SECONDS,
  });
  if (phoneLimit.available && !phoneLimit.allowed) {
    throw new TenancyClaimError("Too many attempts. Please try again later.", "RATE_LIMITED", 429);
  }

  if (requestIp) {
    const ipLimit = await checkFixedWindowLimit({
      scope: `tenancy-claim:${scope}:ip`,
      identifier: requestIp,
      maxAttempts: CLAIM_IP_LIMIT,
      windowSeconds: CLAIM_IP_WINDOW_SECONDS,
    });
    if (ipLimit.available && !ipLimit.allowed) {
      throw new TenancyClaimError(
        "Too many attempts from this network. Please try again later.",
        "RATE_LIMITED",
        429,
      );
    }
  }
}

/**
 * The most recent claim-purpose OTP row for a canonical (`+91XXXXXXXXXX`)
 * phone. `phone_verification_otps.phone` is written via
 * `normalizeWhatsAppPhone` (digits only, e.g. `919876543210`) by
 * `AuthOtpService` regardless of what format the sender used, so the
 * canonical phone is converted to that format here before querying — never
 * compared directly.
 *
 * Read-only: this must never be the thing that extends a proof's life —
 * `lookup` calls this same function and must not refresh or touch the row.
 *
 * `failure_reason` is selected because, for a `CLAIM_OTP_PURPOSE` row, it
 * doubles as the claim-proof token hash (see `claim-eligibility.ts`'s
 * `CLAIM_TOKEN_HASH_PREFIX`) — not because anything here cares about an
 * actual failure reason.
 */
export async function loadClaimOtpProof(db: any, canonicalPhone: string) {
  const otpPhone = normalizeWhatsAppPhone(canonicalPhone);
  return db.phoneVerificationOtp.findFirst({
    where: { phone: otpPhone, purpose: CLAIM_OTP_PURPOSE },
    orderBy: { created_at: "desc" },
    select: { id: true, status: true, purpose: true, verified_at: true, failure_reason: true },
  });
}

/**
 * Throws `OTP_PROOF_REQUIRED` unless a fresh, verified claim-purpose OTP
 * exists *and* `presentedClaimToken` matches the token that was handed to
 * whoever verified it — otherwise returns that row so the caller can later
 * consume the *same* row it just validated (see `consumeClaimProof`) rather
 * than re-querying "most recent" a second time, which could resolve to a
 * different row if a new OTP was requested in between.
 *
 * SECURITY (final security review, finding 1): the token check is what
 * stops an attacker who merely knows the victim's phone number from riding
 * the victim's own OTP verification — see `claim-eligibility.ts`'s module
 * comment for the full attack this closes. Both `lookup` and `confirm` call
 * this, so neither is usable without the token.
 */
export async function assertValidClaimProof(
  db: any,
  canonicalPhone: string,
  presentedClaimToken: string | null | undefined,
  now: Date,
) {
  const proof = await loadClaimOtpProof(db, canonicalPhone);
  if (
    !proof ||
    !isOtpProofValid(proof, now) ||
    !isClaimProofTokenValid(proof.failure_reason, presentedClaimToken)
  ) {
    throw new TenancyClaimError(
      "This phone number has not been freshly verified. Request a new code and verify it before continuing.",
      "OTP_PROOF_REQUIRED",
      401,
    );
  }
  return proof;
}

/**
 * Marks a claim-purpose OTP proof used, so it can never satisfy a second
 * claim. Guarded: the update's `where` re-asserts `status: "VERIFIED"`, so
 * this is a single atomic "claim the row" operation, not a read-then-write —
 * two concurrent `confirm` calls racing the same proof will not both see
 * `count === 1`. Postgres resolves the race at the row lock: whichever
 * transaction's `UPDATE` commits first wins; the other's `WHERE` re-evaluates
 * against the now-`"CONSUMED"` row under READ COMMITTED and matches zero
 * rows. The caller must treat `count !== 1` as a lost race and fail the
 * whole claim — never proceed as if consumption succeeded.
 *
 * `"CONSUMED"` is a new value for `phone_verification_otps.status`, which is
 * a plain string column (no Prisma/DB enum, no migration needed) — see
 * CLAUDE.md's note that many status columns in this schema are unenumerated
 * strings.
 */
export async function consumeClaimProof(tx: any, proofId: string) {
  const result = await tx.phoneVerificationOtp.updateMany({
    where: { id: proofId, status: "VERIFIED" },
    data: { status: "CONSUMED" },
  });
  return result.count === 1;
}

/**
 * `isClaimable` asks whether the bound profile can sign in, not whether one
 * exists. Deriving it here — in one place both call sites go through — keeps a
 * future caller from passing a raw row and silently failing closed.
 */
function withLoginFlag(tenant: any) {
  return { ...tenant, profile_has_login: tenant?.profiles?.auth_user_id != null };
}

const TENANT_CLAIM_SELECT = {
  id: true,
  hostel_id: true,
  owner_id: true,
  access_mode: true,
  status: true,
  // SECURITY (final security review, finding 2): needed by `isClaimable` —
  // a tenancy already bound to a profile (e.g. a half-activated tenancy
  // `startActivation` bound and Phase 1's `adopt` then picked up, gated on
  // `status` alone) must not be silently re-bound to a second claimant.
  profile_id: true,
  // Identity is centralised: adoption now links a profile, so every
  // owner-managed tenancy carries a `profile_id`. What decides claimability is
  // whether that profile can sign in — a login-less shell is the owner holding
  // the account for the tenant; an auth-linked profile is a real account, and
  // claiming it would be a takeover. Without this, `isClaimable` fails closed
  // and every claim is refused.
  profiles: { select: { auth_user_id: true } },
  display_name: true,
  phone_1: true,
  joined_on: true,
  monthly_rent: true,
  // Not surfaced by `toClaimSummary` — pulled only for the consent snapshot's
  // interpolation variables (finding: unfilled `{{SECURITY_DEPOSIT_AMOUNT}}`
  // / `{{MAINTENANCE_CHARGE_AMOUNT}}` placeholders). `toClaimSummary` is a
  // hand-picked whitelist, not a spread of `tenant`, so adding these here
  // does not change what `lookup` exposes.
  security_deposit: true,
  maintenance_charge: true,
  // Whether this tenant has ever been through onboarding *themselves*. The
  // timestamp alone cannot say: adoption stamps it at creation, so it is
  // already set for every owner-managed tenancy whose tenant has seen nothing.
  // The attestation and the invitation's status are what separate the two.
  // Together they drive `activation_required` on the confirm result.
  // See activation-entry.ts and ADR-155.
  activation_completed_at: true,
  owner_attestations: { take: 1, select: { id: true } },
  tenant_invitations: { orderBy: { created_at: "desc" as const }, take: 1, select: { status: true } },
  hostels: { select: { name: true, profiles: { select: { name: true } } } },
  room_allocations: {
    where: { is_active: true, end_date: null },
    orderBy: { start_date: "desc" as const },
    take: 1,
    select: { room: { select: { room_no: true } } },
  },
} as const;

/**
 * Display data only — see the module comment on why this must never carry
 * money beyond `monthly_rent`. Exported so a test can assert the exact key
 * set and catch a future edit that leaks a financial field.
 */
export function toClaimSummary(tenant: any) {
  return {
    tenant_id: tenant.id as string,
    hostel_name: tenant.hostels?.name ?? null,
    room_no: tenant.room_allocations?.[0]?.room?.room_no ?? null,
    joined_on: tenant.joined_on ?? null,
    owner_name: tenant.hostels?.profiles?.name ?? null,
    monthly_rent: tenant.monthly_rent != null ? Number(tenant.monthly_rent) : null,
  };
}

/**
 * The tenancy's current rule version, resolved the same way
 * `ActivationWorkflowService`'s private `getActiveRuleVersion` does — reusing
 * `getActiveTemplateAndSyncRuleVersion` (which also creates a default
 * published template + matching `RuleVersion` the first time a hostel is
 * asked, for referential integrity) rather than inventing a second way to
 * find "the current rules." Also carries `owner_name` off the template, the
 * same way `ActivationWorkflowService.getInterpolationVariables` does, since
 * a custom template's content may reference `{{OWNER_NAME}}`.
 */
async function loadActiveRuleVersion(db: any, hostelId: string) {
  const template = await getActiveTemplateAndSyncRuleVersion(db, hostelId, "RESIDENCY");
  const ruleVersion = await db.ruleVersion.findUnique({ where: { id: template.id } });
  const base = ruleVersion || {
    id: template.id,
    hostel_id: hostelId,
    version: `v${template.version_number}`,
    title: template.title,
    content: template.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
    content_snapshot: template.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
  };
  return { ...base, owner_name: template.owner_name };
}

function getRequestIpForRateLimit(requestIp?: string | null) {
  return requestIp || null;
}

/**
 * Guards the branch where `confirm`'s unauthenticated path (no `profileId`)
 * matched an *existing* profile by phone. SECURITY: proving possession of a
 * phone number over OTP must never let a claimant silently inherit -- or
 * reset the password on -- somebody else's account. Indian mobile numbers
 * get reassigned, so the "existing profile" this matches may belong to a
 * different person entirely by now; and even when it's the same person, a
 * marketplace user who already set a password must not have it silently
 * changed underneath them.
 *
 * - No profile at that phone: nothing to guard here; the caller creates one.
 * - A profile that isn't role TENANT: a different kind of account (owner,
 *   admin) never gets folded into a tenancy claim -- `NOT_CLAIMABLE`. The one
 *   exception is an OWNER profile that does not own *this* tenancy's hostel
 *   (`hostelOwnerId`) -- Hostel A's owner may still claim a tenancy at
 *   Hostel B. An OWNER profile that owns this exact hostel is never let
 *   through, regardless of `hostelOwnerId`.
 * - A TENANT profile that already has a `password_hash`: a real,
 *   credentialed account. Refuse with `SIGN_IN_REQUIRED` -- the claimant
 *   must sign in on that account first and retry the claim through the
 *   already-authenticated `profileId` path (`confirm` never accepts a
 *   password there, so it can never touch this account's credentials).
 * - A TENANT profile with no `password_hash` (an invitation-created shell
 *   that was never activated): nothing to protect yet, so `confirm` may
 *   still set one for it below -- unchanged from prior behaviour.
 *
 * Pure -- takes plain input, exported for direct testing, same idiom as
 * `assertAcknowledgementsComplete`.
 */
export function assertClaimablePhoneMatch(
  existingByPhone: { id?: string; role: string; password_hash?: string | null } | null,
  hostelOwnerId?: string | null,
) {
  if (!existingByPhone) return;
  // Fails closed when hostelOwnerId is unknown: only an explicitly-different
  // hostel owner is let through, never an absence of information.
  const isDifferentHostelOwner =
    existingByPhone.role === "OWNER" && Boolean(hostelOwnerId) && existingByPhone.id !== hostelOwnerId;
  if (existingByPhone.role !== "TENANT" && !isDifferentHostelOwner) {
    throw new TenancyClaimError(
      "This phone number is already linked to a different kind of Stayo account",
      "NOT_CLAIMABLE",
      409,
    );
  }
  if (existingByPhone.password_hash) {
    throw new TenancyClaimError(
      "An account already exists for this phone number. Sign in, then claim this tenancy from your account.",
      "SIGN_IN_REQUIRED",
      401,
    );
  }
}

/**
 * Throws `ACKNOWLEDGEMENTS_REQUIRED` unless every acknowledgement in
 * `REQUIRED_ACKNOWLEDGEMENTS` is explicitly `true` — the same gate
 * `ActivationWorkflowService.acceptRules` applies before it will write a
 * `TenantPolicyAcceptance`. A frontend checkbox no endpoint enforces is
 * decoration; this is the endpoint that must enforce it for a claimed
 * tenancy. Pure — takes plain input, exported for direct testing.
 */
export function assertAcknowledgementsComplete(acknowledgements: Record<string, boolean> | null | undefined) {
  const given = acknowledgements || {};
  const missing = REQUIRED_ACKNOWLEDGEMENTS.filter((key) => given[key] !== true);
  if (missing.length > 0) {
    throw new TenancyClaimError(
      `Please acknowledge all rules before continuing: ${missing.join(", ")}`,
      "ACKNOWLEDGEMENTS_REQUIRED",
      400,
    );
  }
}

/**
 * A tenant's raw "this entry looks wrong" input, captured before
 * `confirm` decides what to do with it. `itemRefs` are opaque strings the
 * frontend statement view attaches to whichever rent-month/payment rows the
 * tenant marks (see `claimSteps.ts`'s `rentMonthRef`/`paymentRef`) — this
 * layer never re-parses or re-validates them against the ledger; the point
 * of a dispute is capturing what the tenant *said* looks wrong so the owner
 * can look into it, not re-deciding who's right.
 */
export interface ClaimDisputeInput {
  itemRefs: string[];
  note: string | null;
}

/**
 * Normalises raw dispute input off the wire into `ClaimDisputeInput`, or
 * `null` when there is nothing to record — i.e. the tenant picked "This
 * looks right" (both `itemRefs` and `note` empty/absent). Pure, exported for
 * direct testing. Deliberately lenient about *which* of the two is present:
 * a tenant who only typed a note without ticking a specific row, or only
 * ticked rows without adding a note, still has something worth telling the
 * owner about.
 */
export function normalizeDisputeInput(
  input: { itemRefs?: string[] | null; note?: string | null } | null | undefined,
): ClaimDisputeInput | null {
  const itemRefs = Array.from(
    new Set((input?.itemRefs ?? []).map((ref) => String(ref ?? "").trim()).filter(Boolean)),
  ).slice(0, 50);
  const note = typeof input?.note === "string" ? input.note.trim().slice(0, 2000) : "";
  if (itemRefs.length === 0 && !note) return null;
  return { itemRefs, note: note || null };
}

/**
 * The `complaints` row's `title`/`description` for a claim-time dispute.
 * Pure — takes plain input, exported for direct testing. `complaints` (not
 * `tenant_notes` or `change_requests`) is the table this writes to; see the
 * module comment above `confirm` for why.
 */
export function buildDisputeComplaintContent(tenantName: string, dispute: ClaimDisputeInput) {
  const title = `${tenantName} disputed records while taking over their account`;
  const itemsLine =
    dispute.itemRefs.length > 0
      ? `Flagged entries: ${dispute.itemRefs.join(", ")}`
      : "No specific entries flagged.";
  const noteLine = dispute.note ? `Tenant's note: ${dispute.note}` : "No additional note provided.";
  const description = [
    `${tenantName} has just taken charge of their own Stayo account. Reviewing the records you kept for them, they flagged something as needing clarification.`,
    itemsLine,
    noteLine,
    "This does not block their access -- they already have their account. Please reach out to clarify and resolve the disagreement.",
  ].join("\n\n");
  return { title, description };
}

export const tenancyClaimService = {
  /**
   * Claimable tenancies for a phone number, as display data only. An empty
   * array is a normal outcome (nothing claimable), not an error — several
   * matches are also legitimate (different hostels, or a past and present
   * stay under the same number) and the caller shows a picker.
   */
  async lookup(params: { phone: string; claimToken?: string | null; requestIp?: string | null }) {
    const canonicalPhone = normalizeIndianPhone(params.phone);
    if (!canonicalPhone) {
      throw new TenancyClaimError("Invalid phone number", "VALIDATION_ERROR", 400);
    }

    await enforceClaimRateLimits("lookup", canonicalPhone, getRequestIpForRateLimit(params.requestIp));
    // SECURITY (final security review, finding 1): requires the claim-proof
    // token, not just a fresh verified OTP for this phone — otherwise an
    // attacker who merely knows the victim's number could poll this
    // endpoint as an oracle for `tenant_id` the instant the victim verifies.
    await assertValidClaimProof(prisma, canonicalPhone, params.claimToken, new Date());

    const tenants = await prisma.tenants.findMany({
      where: { phone_1: canonicalPhone },
      select: TENANT_CLAIM_SELECT,
    });

    return tenants
      .filter((tenant: any) => isClaimable(withLoginFlag(tenant)))
      .map(toClaimSummary);
  },

  /**
   * A read-only statement of what the owner recorded for one claimable
   * tenancy: stay start date, rent, deposit, every rent month with its
   * status, every payment the owner recorded, and the outstanding total —
   * so the tenant reads what they're inheriting before deciding whether it
   * looks right, rather than taking it on trust.
   *
   * SECURITY: gated by the exact same OTP proof as `lookup` — this is a
   * stranger's financial history until the phone number is proven — and,
   * critically, `assertValidClaimProof` is read-only (see its own doc
   * comment). This method never calls `consumeClaimProof`, so a tenant can
   * fetch (or re-fetch, while reading) the statement without spending the
   * single-use proof `confirm` still needs to actually complete the claim.
   *
   * Financial figures are composed, never recalculated: rent-month
   * status/amounts come straight off `rent_obligations`, payments off
   * `payments` (including `offline_recorded_by`, exactly as
   * `financial-timeline-service.ts` already reads it, to mark which entries
   * the owner recorded by hand), and the outstanding total is
   * `financialService.getTenantDues`'s own `total_due` — the one place
   * "what is owed" is decided (see CLAUDE.md).
   */
  async statement(params: { tenantId: string; phone: string; claimToken?: string | null; requestIp?: string | null }) {
    const canonicalPhone = normalizeIndianPhone(params.phone);
    if (!canonicalPhone) {
      throw new TenancyClaimError("Invalid phone number", "VALIDATION_ERROR", 400);
    }
    const tenantId = String(params.tenantId || "").trim();
    if (!tenantId) {
      throw new TenancyClaimError("A tenancy id is required", "VALIDATION_ERROR", 400);
    }

    await enforceClaimRateLimits("lookup", canonicalPhone, getRequestIpForRateLimit(params.requestIp));
    // Read-only proof check — never consumes. See the method doc comment.
    await assertValidClaimProof(prisma, canonicalPhone, params.claimToken, new Date());

    // Same eligibility + phone-ownership guard as `lookup`/`confirm`: a
    // fresh, verified proof for this phone is not licence to read *any*
    // tenant's statement, only one this exact phone number can claim.
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: TENANT_CLAIM_SELECT,
    });
    const tenantPhone = tenant ? normalizeIndianPhone(tenant.phone_1) : null;
    if (!tenant || !isClaimable(withLoginFlag(tenant)) || tenantPhone !== canonicalPhone) {
      throw new TenancyClaimError(
        "This tenancy can no longer be claimed with this phone number",
        "NOT_CLAIMABLE",
        409,
      );
    }

    const [obligations, payments, dues] = await Promise.all([
      prisma.rent_obligations.findMany({
        where: { tenant_id: tenant.id, obligation_type: "RENT" },
        orderBy: { rent_month: "asc" },
        select: { id: true, rent_month: true, status: true, total_amount: true },
      }),
      prisma.payments.findMany({
        where: { tenant_id: tenant.id },
        orderBy: { payment_date: "asc" },
        select: {
          id: true,
          obligation_id: true,
          amount_paid: true,
          payment_method: true,
          payment_date: true,
          offline_recorded_by: true,
        },
      }),
      financialService.getTenantDues(tenant.id, tenant.owner_id ?? undefined, tenant.hostel_id),
    ]);

    const paidByObligation = new Map<string, number>();
    for (const payment of payments) {
      paidByObligation.set(
        payment.obligation_id,
        (paidByObligation.get(payment.obligation_id) ?? 0) + Number(payment.amount_paid),
      );
    }

    return {
      tenant_id: tenant.id as string,
      hostel_name: tenant.hostels?.name ?? null,
      owner_name: tenant.hostels?.profiles?.name ?? null,
      room_no: tenant.room_allocations?.[0]?.room?.room_no ?? null,
      stay_start_date: tenant.joined_on ?? null,
      monthly_rent: tenant.monthly_rent != null ? Number(tenant.monthly_rent) : null,
      security_deposit: tenant.security_deposit != null ? Number(tenant.security_deposit) : null,
      rent_months: obligations.map((ob: any) => {
        const paid = paidByObligation.get(ob.id) ?? 0;
        const amount = Number(ob.total_amount);
        return {
          obligation_id: ob.id as string,
          rent_month: ob.rent_month,
          status: ob.status as string,
          amount,
          paid,
          outstanding: Math.max(amount - paid, 0),
        };
      }),
      payments: payments.map((payment: any) => ({
        payment_id: payment.id as string,
        obligation_id: payment.obligation_id as string,
        amount: Number(payment.amount_paid),
        date: payment.payment_date,
        method: payment.payment_method as string,
        recorded_by_owner: payment.offline_recorded_by != null,
      })),
      outstanding_total: dues.total_due,
    };
  },

  /**
   * Confirms a claim in one transaction: re-validates OTP proof, re-checks
   * eligibility, attaches an identity, flips access mode, writes the
   * tenancy's first genuine `TenantPolicyAcceptance`, and consumes the OTP
   * proof so it cannot satisfy a second claim.
   *
   * `profileId` must come from a verified session (e.g. `getSession(req).sub`
   * for a signed-in TENANT), never straight from the request body — an
   * unverified body field would let anyone attach a tenancy, and the
   * `mobile_verified`/consent record that comes with it, to an account that
   * is not theirs.
   */
  async confirm(params: {
    tenantId: string;
    phone: string;
    profileId?: string | null;
    /**
     * SECURITY (final security review, finding 1): required, same as
     * `lookup` — the exact token handed back when this phone's claim OTP
     * was verified. Without it, `assertValidClaimProof` refuses with
     * `OTP_PROOF_REQUIRED` even for an otherwise-fresh, verified proof.
     */
    claimToken?: string | null;
    requestIp?: string | null;
    requestUserAgent?: string | null;
    /** Must have every key in `REQUIRED_ACKNOWLEDGEMENTS` set to exactly `true`. */
    acknowledgements?: Record<string, boolean> | null;
    /** The tenant's own typed signature. Never backfilled from `profile.name`. */
    typedSignatureName?: string | null;
    /** Optional — the tenant supplying their own details rather than inheriting the owner's placeholder. */
    name?: string | null;
    email?: string | null;
    /**
     * Required exactly when `profileId` is absent (an unauthenticated
     * claimant is about to get — or reuse — an account and needs a real
     * credential); rejected when `profileId` is present, since that session
     * already authenticates the caller and accepting a password there would
     * be a way to overwrite an existing account's credentials. See the
     * checks immediately below.
     */
    password?: string | null;
    /**
     * The tenant's verdict on the statement they were shown (see
     * `tenancyClaimService.statement`) before confirming: `null`/absent (or
     * both fields empty) means "this looks right" and the claim completes
     * exactly as it always has. A non-empty `itemRefs` and/or `note` means
     * "something's wrong" — the claim still completes (see the module
     * comment: a dispute must never withhold the account) but a `complaints`
     * row is written and the owner is notified. Normalised by
     * `normalizeDisputeInput` before use.
     */
    dispute?: { itemRefs?: string[] | null; note?: string | null } | null;
  }) {
    const disputeInput = normalizeDisputeInput(params.dispute);
    const canonicalPhone = normalizeIndianPhone(params.phone);
    if (!canonicalPhone) {
      throw new TenancyClaimError("Invalid phone number", "VALIDATION_ERROR", 400);
    }
    const tenantId = String(params.tenantId || "").trim();
    if (!tenantId) {
      throw new TenancyClaimError("A tenancy id is required", "VALIDATION_ERROR", 400);
    }

    const password = typeof params.password === "string" ? params.password : "";
    if (params.profileId) {
      if (password) {
        throw new TenancyClaimError(
          "You're already signed in — no password is needed to claim this tenancy.",
          "VALIDATION_ERROR",
          400,
        );
      }
    } else if (password.length < 8) {
      throw new TenancyClaimError(
        "A password of at least 8 characters is required to create your account.",
        "VALIDATION_ERROR",
        400,
      );
    }

    assertAcknowledgementsComplete(params.acknowledgements);

    await enforceClaimRateLimits("confirm", canonicalPhone, getRequestIpForRateLimit(params.requestIp));

    // Hashed once, outside the transaction (bcrypt is deliberately slow, and
    // there's no reason to hold the transaction's row locks through it).
    // `null` for an already-signed-in caller — who supplies no password (see
    // above) and needs none, since `createSessionAndTokens` is never called
    // for that path either (they already have a live session).
    const passwordHash = params.profileId ? null : await hashPassword(password);

    // Set inside the transaction once the tenancy is loaded, so the audit
    // log below (which runs after the transaction commits) has the owner id
    // without a second query — `result` itself intentionally omits it (see
    // `toClaimSummary`'s "display data only" contract). `tenantNameForNotice`
    // rides along the same way, for the owner notification sent after commit.
    let ownerIdForAudit: string | null = null;
    let tenantNameForNotice: string | null = null;

    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const now = new Date();

        // 1. Re-validate the OTP proof independently — never trust that
        //    lookup ran. Keep the validated row so step 6 consumes this
        //    exact row, not whatever "most recent" resolves to later. Also
        //    re-validates the claim-proof token (finding 1) inside this same
        //    transaction, immediately before it's spent in step 6 — never
        //    trust that `lookup`'s earlier token check still holds.
        const proof = await assertValidClaimProof(tx, canonicalPhone, params.claimToken, now);

        // 2. Reload the tenancy and re-check eligibility + phone ownership.
        //    The owner may have edited the phone between lookup and confirm;
        //    the old number must stop matching, so this compares against the
        //    freshly-reloaded row, not anything cached from lookup. A
        //    missing tenancy and a no-longer-claimable one collapse to the
        //    same response — a 404 vs 409 split would let a caller probe
        //    which UUIDs are real tenancies. `params.profileId ?? null` lets
        //    an already-signed-in caller re-confirm a tenancy already bound
        //    to their own profile (finding 2) without being refused by the
        //    same check that blocks a second claimant from displacing it.
        const tenant = await tx.tenants.findUnique({
          where: { id: tenantId },
          select: TENANT_CLAIM_SELECT,
        });
        const tenantPhone = tenant ? normalizeIndianPhone(tenant.phone_1) : null;
        if (
          !tenant ||
          !isClaimable(withLoginFlag(tenant), params.profileId ?? null) ||
          tenantPhone !== canonicalPhone
        ) {
          throw new TenancyClaimError(
            "This tenancy can no longer be claimed with this phone number",
            "NOT_CLAIMABLE",
            409,
          );
        }
        ownerIdForAudit = tenant.owner_id ?? null;
        tenantNameForNotice = resolveTenantName(tenant);

        // 3. Attach identity — reuse an existing marketplace profile rather
        //    than creating a second one for the same phone number (see
        //    docs/obsidian/Business-Rules.md, "Account types").
        let profile: any = null;
        if (params.profileId) {
          profile = await tx.profile.findUnique({ where: { id: params.profileId } });
          if (!profile) {
            throw new TenancyClaimError("Signed-in account not found", "NOT_FOUND", 404);
          }
          if (profile.role !== "TENANT") {
            // An owner of a DIFFERENT hostel may still claim this tenancy
            // (Hostel A owner -> Hostel B tenant is allowed); an owner of
            // THIS hostel may never claim it as their own tenancy.
            const isDifferentHostelOwner = profile.role === "OWNER" && Boolean(tenant.owner_id) && profile.id !== tenant.owner_id;
            if (!isDifferentHostelOwner) {
              const message = profile.role === "OWNER"
                ? "You already own this hostel and cannot become its tenant"
                : "Only a tenant account can claim a tenancy";
              throw new TenancyClaimError(message, "ROLE_MISMATCH", 400);
            }
          }
        } else {
          const existingByPhone = await tx.profile.findUnique({ where: { phone: canonicalPhone } });
          if (existingByPhone) {
            // SECURITY: throws NOT_CLAIMABLE or SIGN_IN_REQUIRED — see the
            // guard's own doc comment. A credentialed existing account is
            // never reused here; the claimant must sign in first.
            assertClaimablePhoneMatch(existingByPhone, tenant.owner_id);
            profile = existingByPhone;
          } else {
            // The tenant may supply their own name/email rather than
            // inheriting the owner's placeholder (`+91XXXXXXXXXX@hms.temp`,
            // the owner's typed `display_name`) — `resolveActivationEmail`
            // already encodes "prefer an explicit email, else fall back to
            // the phone placeholder," so pass the typed email through it the
            // same way an invitation's email would flow through.
            const typedName = typeof params.name === "string" ? params.name.trim() : "";
            const typedEmail = typeof params.email === "string" ? params.email.trim() : "";
            const email = resolveActivationEmail({
              profile: typedEmail ? { email: typedEmail } : null,
              invitation: null,
              phone: canonicalPhone,
            });
            if (!email) {
              throw new TenancyClaimError("Invalid phone number", "VALIDATION_ERROR", 400);
            }
            try {
              profile = await tx.profile.create({
                data: {
                  id: crypto.randomUUID(),
                  email,
                  name: typedName || resolveTenantName(tenant),
                  phone: canonicalPhone,
                  role: "TENANT",
                  is_active: true,
                  owner_id: tenant.owner_id,
                  mobile_verified: true,
                  phone_verified: true,
                },
              });
            } catch (error: any) {
              if (error?.code === "P2002") {
                throw new TenancyClaimError(
                  "That email is already linked to a different Stayo account",
                  "NOT_CLAIMABLE",
                  409,
                );
              }
              throw error;
            }
          }
        }

        // Every path above lands on a TENANT profile; make sure it carries
        // the phone just re-verified, since a SELF_SERVE tenant's messaging
        // (`resolveTenantPhone`) reads `profiles.phone` before `tenant.phone_1`
        // — leaving it stale would silently misroute reminders after the claim.
        //
        // `passwordHash` also rides this same update whenever the caller
        // isn't already signed in. By this point `assertClaimablePhoneMatch`
        // has already refused any existing profile that had a
        // `password_hash` (SIGN_IN_REQUIRED) — so a write here only ever sets
        // a *first* password: either a brand-new profile, or an
        // invitation-created shell that was never activated. It never resets
        // credentials on an account someone already uses. Writing it here,
        // inside the transaction, is what lets an ordinary `/api/auth/login`
        // retry work later even if the Supabase session-mint step after
        // commit fails — see the comment on that step below.
        //
        // `is_active: true` rides along too (finding 3): a reused shell
        // profile from `startActivation` is written `is_active: false`, and
        // this is exactly the branch that reuses one. Without this, the
        // claim and its first session (minted below, after commit) succeed,
        // but every *later* login throws `FORBIDDEN: Account is disabled`
        // (`authService.login` checks `is_active`, but this update never
        // set it). A brand-new profile is already `is_active: true` (see the
        // create branch above), so this is a harmless re-write there.
        if (
          profile.phone !== canonicalPhone ||
          !profile.mobile_verified ||
          !profile.phone_verified ||
          passwordHash ||
          !profile.is_active
        ) {
          try {
            profile = await tx.profile.update({
              where: { id: profile.id },
              data: {
                phone: canonicalPhone,
                mobile_verified: true,
                phone_verified: true,
                is_active: true,
                ...(passwordHash ? { password_hash: passwordHash } : {}),
              },
            });
          } catch (error: any) {
            if (error?.code === "P2002") {
              throw new TenancyClaimError(
                "This phone number is already linked to a different Stayo account",
                "NOT_CLAIMABLE",
                409,
              );
            }
            throw error;
          }
        }

        // `tenants_one_live_tenancy_per_profile` would reject a second live
        // tenancy anyway, but as an opaque constraint error — check first so a
        // person who already lives somewhere else gets a real explanation.
        //
        // The tenancy being claimed is excluded, and that exclusion is the
        // whole reason this call worked before ADR-136 and not after: adoption
        // now binds a `profile_id` to the tenancy, so by the time someone
        // claims theirs the profile already holds it. Asking "may this profile
        // start a *new* tenancy?" then found that very tenancy, saw it live,
        // and refused — the claim flow rejecting exactly the tenancies it
        // exists to serve. A live tenancy anywhere else still blocks. See
        // ADR-153.
        await tenancyEligibilityService.assertCanStartNewTenancy(profile.id, tenant.owner_id, tx, {
          ignoreTenancyId: tenant.id,
        });

        // 4. Flip access — same tenant_id, so every obligation, payment and
        //    receipt already on the record survives untouched.
        await tx.tenants.update({
          where: { id: tenant.id },
          data: {
            profile_id: profile.id,
            access_mode: "SELF_SERVE",
            mobile_verified: true,
            updated_at: now,
          },
        });

        // 5. The first genuine tenant consent this tenancy has ever had — the
        //    owner's `tenant_owner_attestations` row is left exactly as it was
        //    (it stays true: the owner did keep these books for a period).
        //    Variables mirror `ActivationWorkflowService.getInterpolationVariables`
        //    — omitting SECURITY_DEPOSIT_AMOUNT/MAINTENANCE_CHARGE_AMOUNT left
        //    the default rules template's placeholders unfilled verbatim.
        const ruleVersion = await loadActiveRuleVersion(tx, tenant.hostel_id);
        const variables = {
          TENANT_NAME: resolveTenantName(tenant),
          HOSTEL_NAME: tenant.hostels?.name || "Hostel",
          ROOM_NUMBER: tenant.room_allocations?.[0]?.room?.room_no ?? "N/A",
          MONTHLY_RENT: tenant.monthly_rent != null ? Number(tenant.monthly_rent) : 0,
          SECURITY_DEPOSIT_AMOUNT: tenant.security_deposit != null ? Number(tenant.security_deposit) : 0,
          MAINTENANCE_CHARGE_AMOUNT: tenant.maintenance_charge != null ? Number(tenant.maintenance_charge) : 0,
          JOINING_DATE: tenant.joined_on ? new Date(tenant.joined_on).toISOString().slice(0, 10) : "",
          OWNER_NAME: ruleVersion.owner_name || tenant.hostels?.profiles?.name || "Hostel Owner",
        };
        const content = ruleVersion.content ?? ruleVersion.content_snapshot ?? DEFAULT_AGREEMENT_TEMPLATE;
        const typedSignatureName =
          typeof params.typedSignatureName === "string" ? params.typedSignatureName.trim() : "";
        const rulesSnapshot = {
          id: ruleVersion.id,
          version: ruleVersion.version,
          title: ruleVersion.title ?? "Standard Hostel Rules",
          content: interpolateRulesContent(content, variables),
          // Same key `ActivationWorkflowService.rulePayload` records — what
          // was required, not the caller-submitted answers (those were
          // already validated true-or-refused by `assertAcknowledgementsComplete`
          // above; the audit event below records that validation happened).
          required_acknowledgements: REQUIRED_ACKNOWLEDGEMENTS,
        };

        const existingAcceptance = await tx.tenantPolicyAcceptance.findUnique({
          where: {
            tenant_id_rule_version_id: {
              tenant_id: tenant.id,
              rule_version_id: ruleVersion.id,
            },
          },
        });
        if (!existingAcceptance) {
          try {
            await tx.tenantPolicyAcceptance.create({
              data: {
                tenant_id: tenant.id,
                hostel_id: tenant.hostel_id,
                rule_version_id: ruleVersion.id,
                rules_version: ruleVersion.version,
                rules_snapshot: rulesSnapshot,
                accepted_ip: params.requestIp || null,
                accepted_user_agent: params.requestUserAgent || null,
                // Never fabricate a signature. For a newly created profile,
                // `profile.name` is the owner's typed `display_name` or the
                // literal "Tenant" — neither is something the tenant typed.
                // An absent typed name is stored as null, not backfilled.
                typed_signature_name: typedSignatureName || null,
              },
            });
          } catch (error: any) {
            // Same race tolerated by ActivationWorkflowService.acceptRules —
            // the unique constraint is the real guard, this is belt-and-braces.
            if (error?.code !== "P2002") throw error;
          }
        }

        // 5.5. Record a dispute, if the tenant raised one over the statement
        //      shown before confirming. Deliberately inside this same
        //      transaction — the record is as durable as the claim itself —
        //      but it is a record, never a gate: nothing above or below this
        //      block reads `disputeInput` to decide whether to proceed. A
        //      dispute must never block the tenant from taking charge of
        //      their own account (see the module comment).
        //
        //      Written to `complaints` (not `tenant_notes` or
        //      `change_requests`): `tenant_notes` is documented as
        //      "owner-private notes" the owner writes about a tenant, not
        //      somewhere a tenant's own words belong; `change_requests` is a
        //      structured entity-diff/approval workflow (before/diff,
        //      approval levels) that doesn't fit "the tenant said this looks
        //      wrong" at all. `complaints` already models exactly this
        //      shape — tenant_id + owner_id + title/description + a
        //      PENDING→resolved status the owner can close out — and is
        //      already wired into the owner's daily briefing
        //      (`briefing-engine.ts` counts `status: "PENDING"` complaints
        //      toward the owner's operations score), so a dispute here
        //      surfaces on a surface the owner already checks, for free.
        //      `tenant.owner_id` is guarded rather than asserted non-null —
        //      `complaints.owner_id` is a required column, and an
        //      owner-managed tenancy should always carry one, but this is a
        //      dispute record, not the claim itself: if it's ever absent,
        //      skip the write and log rather than fail an otherwise-valid
        //      claim over a missing owner id.
        let disputeRecorded = false;
        if (disputeInput) {
          if (tenant.owner_id) {
            const { title, description } = buildDisputeComplaintContent(
              resolveTenantName(tenant),
              disputeInput,
            );
            await tx.complaints.create({
              data: {
                id: crypto.randomUUID(),
                tenant_id: tenant.id,
                owner_id: tenant.owner_id,
                hostel_id: tenant.hostel_id,
                title,
                description,
                category: "TENANCY_CLAIM_DISPUTE",
                priority: "HIGH",
              },
            });
            disputeRecorded = true;
          } else {
            logger.warn("tenancy_claim.dispute_skipped_no_owner", { tenant_id: tenant.id });
          }
        }

        // 6. Consume the OTP proof — after every other validation and write
        //    has succeeded, immediately before returning. Guarded: see
        //    `consumeClaimProof`. A lost race here throws, which rolls back
        //    every write this transaction made (profile creation/update, the
        //    access-mode flip, the policy acceptance) along with it — the
        //    whole claim fails atomically rather than partially applying.
        const consumed = await consumeClaimProof(tx, proof.id);
        if (!consumed) {
          throw new TenancyClaimError(
            "This claim proof was already used. Request a new code and verify it before continuing.",
            "OTP_PROOF_REQUIRED",
            401,
          );
        }

        // 7. Tenancy summary — same shape lookup returns, plus what changed.
        return {
          ...toClaimSummary(tenant),
          profile_id: profile.id as string,
          access_mode: "SELF_SERVE" as const,
          dispute_recorded: disputeRecorded,
          // Claiming links the account; it does not collect the identity,
          // documents, guardian details or residency agreement that every
          // self-serve tenant provides. When those are still owed, the client
          // sends the tenant into onboarding instead of the dashboard — which
          // it can now do on their session alone. See ADR-155.
          activation_required: !hasCompletedActivation({
            status: tenant.status,
            activationCompletedAt: tenant.activation_completed_at,
            invitationStatus: (tenant as any).tenant_invitations?.[0]?.status ?? null,
            ownerAttested: ((tenant as any).owner_attestations?.length ?? 0) > 0,
          }),
        };
      }, { timeout: 30000 });

      await eventLog.log(
        "tenancy_claimed",
        ownerIdForAudit,
        {
          tenant_id: result.tenant_id,
          profile_id: result.profile_id,
          request_ip: params.requestIp || null,
        },
        result.tenant_id,
      );
      logger.info("tenancy_claim.confirmed", {
        tenant_id: result.tenant_id,
        profile_id: result.profile_id,
        request_ip: params.requestIp || null,
      });

      // Tell the owner: they've been keeping this person's books by hand,
      // and that changes the moment the tenant is on the app themselves.
      // Reuses the same in-app `notifications` table every other lifecycle
      // event in this codebase writes through (see
      // `agreement-lifecycle-service.ts`'s `notifyOwner`/`notifyTenant`)
      // rather than inventing a new channel — no WhatsApp template exists
      // for this event, and this repo's business rule is compose/reuse, not
      // build a new surface. Fire-and-forget: the claim already committed
      // above, so a notification failure must never look like the claim
      // failed.
      if (ownerIdForAudit) {
        const tenantLabel = tenantNameForNotice || "Your tenant";
        const roomLabel = result.room_no ? ` (Room ${result.room_no})` : "";
        await notificationService
          .createNotification(
            ownerIdForAudit,
            "A tenant joined Stayo",
            `${tenantLabel}${roomLabel} has claimed their tenancy and can now manage payments and requests from the Stayo app themselves.`,
            "tenancy_claim",
          )
          .catch((error: any) => {
            logger.warn("tenancy_claim.owner_notification_failed", {
              tenant_id: result.tenant_id,
              owner_id: ownerIdForAudit,
              reason: error?.message || String(error),
            });
          });

        // A second, separate notification when the tenant disputed part of
        // the statement — the `complaints` row above is the durable record;
        // this is just what tells the owner to go look at it. Independently
        // fire-and-forget from the notification above: one failing must
        // never suppress the other, and neither can ever fail the claim,
        // which already committed.
        if (result.dispute_recorded) {
          await notificationService
            .createNotification(
              ownerIdForAudit,
              "A tenant disputed records you kept",
              `${tenantLabel}${roomLabel} has taken charge of their own account and flagged some entries in your records as needing clarification. Please reach out to sort it out.`,
              "tenancy_claim_dispute",
            )
            .catch((error: any) => {
              logger.warn("tenancy_claim.dispute_notification_failed", {
                tenant_id: result.tenant_id,
                owner_id: ownerIdForAudit,
                reason: error?.message || String(error),
              });
            });
        }
      }

      // Everything above is durably committed — nothing past this point is a
      // reason to treat the claim itself as failed. An already-signed-in
      // caller (`profileId` present) needs no new session: they have one,
      // and were never given a password to mint one from anyway.
      if (params.profileId) {
        return result;
      }

      // Mint a session the same way `ActivationWorkflowService`'s ACTIVATE
      // step does (`src/services/tenants/activation-workflow-service.ts`,
      // its "Auto-login" comment): via `authService.createSessionAndTokens`,
      // which provisions/links the profile's Supabase identity
      // (`ensureSupabaseIdentity`) and then signs in for a real Supabase
      // session. That call is an external API request, so — like
      // activation's — it cannot happen inside the Prisma transaction above
      // and necessarily runs after commit.
      //
      // If it fails (Supabase unreachable, etc.), the claim still stands:
      // the tenancy is SELF_SERVE, the profile carries a working
      // `password_hash` written inside the transaction above (step 3.5), and
      // the OTP proof is spent. Swallowing the error here rather than
      // rethrowing is a deliberate choice, not activation's exact shape —
      // activation lets an identical failure propagate as a 500 even though
      // its own DB write already committed; a claim in that same spot has
      // already changed who owns a real financial history, so this returns
      // the successful claim result without a `session` instead. The
      // frontend falls back to routing the claimant to `/login`, where an
      // ordinary password login (which itself calls `ensureSupabaseIdentity`
      // again) self-heals the Supabase side — but only while `auth_user_id`
      // is still null: `ensureSupabaseIdentity` returns early the moment
      // it's set (`lib/auth/supabase-identity.ts`: `if (profile.auth_user_id)
      // return profile.auth_user_id;`), so once some *other* successful
      // login links the identity first, this profile's Supabase password
      // stops being pushed on every subsequent login, not just this one —
      // there is no login-triggered retry of the link itself. Retrying
      // `confirm` itself is never the recovery path: the OTP proof is
      // already consumed (`OTP_PROOF_REQUIRED`) and the tenancy is no longer
      // `OWNER_MANAGED` (`NOT_CLAIMABLE`).
      try {
        const { authService } = await import("../../../lib/services/auth-service");
        const updatedProfile = await prisma.profile.findUnique({ where: { id: result.profile_id } });
        if (!updatedProfile) {
          throw new Error(`Claimed profile ${result.profile_id} vanished before session mint`);
        }
        const activatedTenancy: any = await getActiveTenancy(updatedProfile.id);
        const session = await authService.createSessionAndTokens(
          updatedProfile,
          activatedTenancy?.id || result.tenant_id,
          activatedTenancy?.profile_completed ?? false,
          { ipAddress: params.requestIp || undefined, userAgent: params.requestUserAgent || undefined },
          password,
          activatedTenancy?.status || "ACTIVE",
        );
        return { ...result, session };
      } catch (sessionError: any) {
        logger.error("tenancy_claim.session_mint_failed", {
          tenant_id: result.tenant_id,
          profile_id: result.profile_id,
          reason: sessionError?.message || String(sessionError),
        });
        return result;
      }
    } catch (error: any) {
      logger.warn("tenancy_claim.confirm_refused", {
        tenant_id: tenantId,
        phone: maskWhatsAppPhone(canonicalPhone),
        code: error instanceof TenancyClaimError ? error.code : "UNKNOWN",
        reason: error?.message || String(error),
      });
      throw error;
    }
  },
};
