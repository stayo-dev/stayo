import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { eventLog } from "@/lib/services/event-log-service";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { resolveTenantName } from "@/lib/tenants/tenant-identity";
import { CLAIM_OTP_PURPOSE, isClaimable, isOtpProofValid } from "@/lib/tenants/claim-eligibility";
import {
  getActiveTemplateAndSyncRuleVersion,
  interpolateRulesContent,
  DEFAULT_AGREEMENT_TEMPLATE,
} from "@/utils/default-rules";
import { resolveActivationEmail } from "./invited-profile-resolver";
import { tenancyEligibilityService } from "./tenancy-eligibility-service";

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
 * hung off `tenant_id` — obligations, payments, receipts, deposit. Two rules
 * hold everywhere in this file:
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
 */
export async function loadClaimOtpProof(db: any, canonicalPhone: string) {
  const otpPhone = normalizeWhatsAppPhone(canonicalPhone);
  return db.phoneVerificationOtp.findFirst({
    where: { phone: otpPhone, purpose: CLAIM_OTP_PURPOSE },
    orderBy: { created_at: "desc" },
    select: { id: true, status: true, purpose: true, verified_at: true },
  });
}

/**
 * Throws `OTP_PROOF_REQUIRED` unless a fresh, verified claim-purpose OTP
 * exists; otherwise returns that row so the caller can later consume the
 * *same* row it just validated (see `consumeClaimProof`) rather than
 * re-querying "most recent" a second time, which could resolve to a
 * different row if a new OTP was requested in between.
 */
export async function assertValidClaimProof(db: any, canonicalPhone: string, now: Date) {
  const proof = await loadClaimOtpProof(db, canonicalPhone);
  if (!proof || !isOtpProofValid(proof, now)) {
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

const TENANT_CLAIM_SELECT = {
  id: true,
  hostel_id: true,
  owner_id: true,
  access_mode: true,
  status: true,
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

export const tenancyClaimService = {
  /**
   * Claimable tenancies for a phone number, as display data only. An empty
   * array is a normal outcome (nothing claimable), not an error — several
   * matches are also legitimate (different hostels, or a past and present
   * stay under the same number) and the caller shows a picker.
   */
  async lookup(params: { phone: string; requestIp?: string | null }) {
    const canonicalPhone = normalizeIndianPhone(params.phone);
    if (!canonicalPhone) {
      throw new TenancyClaimError("Invalid phone number", "VALIDATION_ERROR", 400);
    }

    await enforceClaimRateLimits("lookup", canonicalPhone, getRequestIpForRateLimit(params.requestIp));
    await assertValidClaimProof(prisma, canonicalPhone, new Date());

    const tenants = await prisma.tenants.findMany({
      where: { phone_1: canonicalPhone },
      select: TENANT_CLAIM_SELECT,
    });

    return tenants.filter((tenant: any) => isClaimable(tenant)).map(toClaimSummary);
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
    requestIp?: string | null;
    requestUserAgent?: string | null;
    /** Must have every key in `REQUIRED_ACKNOWLEDGEMENTS` set to exactly `true`. */
    acknowledgements?: Record<string, boolean> | null;
    /** The tenant's own typed signature. Never backfilled from `profile.name`. */
    typedSignatureName?: string | null;
    /** Optional — the tenant supplying their own details rather than inheriting the owner's placeholder. */
    name?: string | null;
    email?: string | null;
  }) {
    const canonicalPhone = normalizeIndianPhone(params.phone);
    if (!canonicalPhone) {
      throw new TenancyClaimError("Invalid phone number", "VALIDATION_ERROR", 400);
    }
    const tenantId = String(params.tenantId || "").trim();
    if (!tenantId) {
      throw new TenancyClaimError("A tenancy id is required", "VALIDATION_ERROR", 400);
    }
    assertAcknowledgementsComplete(params.acknowledgements);

    await enforceClaimRateLimits("confirm", canonicalPhone, getRequestIpForRateLimit(params.requestIp));

    // Set inside the transaction once the tenancy is loaded, so the audit
    // log below (which runs after the transaction commits) has the owner id
    // without a second query — `result` itself intentionally omits it (see
    // `toClaimSummary`'s "display data only" contract).
    let ownerIdForAudit: string | null = null;

    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const now = new Date();

        // 1. Re-validate the OTP proof independently — never trust that
        //    lookup ran. Keep the validated row so step 6 consumes this
        //    exact row, not whatever "most recent" resolves to later.
        const proof = await assertValidClaimProof(tx, canonicalPhone, now);

        // 2. Reload the tenancy and re-check eligibility + phone ownership.
        //    The owner may have edited the phone between lookup and confirm;
        //    the old number must stop matching, so this compares against the
        //    freshly-reloaded row, not anything cached from lookup. A
        //    missing tenancy and a no-longer-claimable one collapse to the
        //    same response — a 404 vs 409 split would let a caller probe
        //    which UUIDs are real tenancies.
        const tenant = await tx.tenants.findUnique({
          where: { id: tenantId },
          select: TENANT_CLAIM_SELECT,
        });
        const tenantPhone = tenant ? normalizeIndianPhone(tenant.phone_1) : null;
        if (!tenant || !isClaimable(tenant) || tenantPhone !== canonicalPhone) {
          throw new TenancyClaimError(
            "This tenancy can no longer be claimed with this phone number",
            "NOT_CLAIMABLE",
            409,
          );
        }
        ownerIdForAudit = tenant.owner_id ?? null;

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
            throw new TenancyClaimError("Only a tenant account can claim a tenancy", "ROLE_MISMATCH", 400);
          }
        } else {
          const existingByPhone = await tx.profile.findUnique({ where: { phone: canonicalPhone } });
          if (existingByPhone) {
            if (existingByPhone.role !== "TENANT") {
              throw new TenancyClaimError(
                "This phone number is already linked to a different kind of Stayo account",
                "NOT_CLAIMABLE",
                409,
              );
            }
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
        if (profile.phone !== canonicalPhone || !profile.mobile_verified || !profile.phone_verified) {
          try {
            profile = await tx.profile.update({
              where: { id: profile.id },
              data: { phone: canonicalPhone, mobile_verified: true, phone_verified: true },
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
        await tenancyEligibilityService.assertCanStartNewTenancy(profile.id, tenant.owner_id, tx);

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

      return result;
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
