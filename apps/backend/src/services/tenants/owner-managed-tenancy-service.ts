import crypto from "crypto";
import { logger } from "@/lib/logger";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { ensureActiveAllocation } from "./tenancy-allocation";
import { planObligationLinking } from "./obligation-linking";
import { resolveActivationEmail } from "./invited-profile-resolver";
import { TenancyEligibilityError } from "./tenancy-eligibility-service";

export interface InitializeActiveUnacceptedTenancyParams {
  /** Caller must already hold the row lock on `roomId` (`SELECT ... FOR UPDATE`) — see `ensureActiveAllocation`. */
  tx: any;
  tenantId: string;
  ownerId: string;
  hostelId: string;
  displayName: string;
  /** Canonical (normalized) phone — the identity key a profile is matched or created by. */
  phone: string;
  roomId: string;
  joiningDate: Date;
  /** Existing `tenants.profile_id`, if this tenancy is already linked to one. Null on a brand-new invite. */
  existingProfileId: string | null;
  /**
   * Candidate emails to resolve an activation email from if a new profile has
   * to be created — matches `resolveActivationEmail`'s `profile` / `invitation`
   * inputs, most-trusted first.
   */
  profileEmail: string | null;
  invitationEmail: string | null;
  /** The reservation this tenancy is holding, if any — converted to an allocation and released. */
  reservation: { id: string } | null;
}

export interface InitializeActiveUnacceptedTenancyResult {
  tenant_id: string;
  access_mode: "OWNER_MANAGED";
  status: "ACTIVE";
  acceptance_status: "PENDING";
  display_name: string;
  allocation_created: boolean;
  profile_id: string;
}

/**
 * Bind the tenancy to a person and a real room, without touching acceptance.
 *
 * Steps 1–3 of standing a tenancy up: convert the held reservation into a real
 * room allocation (via `ensureActiveAllocation`'s overbooking guard), bind
 * obligations that were raised before the allocation existed (ADR-149), and
 * link — or create, login-less — the `profiles` row keyed by canonical phone.
 *
 * Kept private and free of any status / acceptance / attestation writes so the
 * one public caller (`initializeActiveUnacceptedTenancy`) owns the meaning of
 * the resulting state.
 */
async function linkTenancyProfileAndAllocation(
  params: InitializeActiveUnacceptedTenancyParams,
): Promise<{ profileId: string; allocationId: string; allocationCreated: boolean }> {
  const { tx, tenantId, ownerId, hostelId, displayName, phone, roomId, joiningDate } = params;

  const { created, allocationId } = await ensureActiveAllocation(tx, {
    tenantId,
    roomId,
    hostelId,
    startDate: joiningDate,
  });

  // Bind obligations raised before this allocation existed.
  //
  // `createInvitation` writes the tenancy's obligations — including the months a
  // mid-year onboarding backfills — while only a *reservation* exists, so they
  // carry `allocation_id: null`. Every duplicate guard downstream is
  // allocation-scoped (the monthly rent cron matches `allocation_id: { in }`,
  // `upsertObligation` matches `allocation_id + rent_month + obligation_type`);
  // `NULL` matches neither, so both were blind to the backfilled months and
  // raised them a second time. Binding them here makes the existing checks — and
  // the `(allocation_id, rent_month, obligation_type)` unique index — cover
  // these rows too, rather than redefining "duplicate" in four places. ADR-149.
  const orphanCandidates = await tx.rent_obligations.findMany({
    where: { tenant_id: tenantId, is_superseded: false },
    select: { id: true, allocation_id: true, obligation_type: true, rent_month: true },
  });
  const linkPlan = planObligationLinking(orphanCandidates as any, allocationId);

  if (linkPlan.link.length > 0) {
    await tx.rent_obligations.updateMany({
      where: { id: { in: linkPlan.link } },
      data: { allocation_id: allocationId },
    });
  }
  if (linkPlan.skipped.length > 0) {
    logger.warn("tenancy.obligation_link_skipped", {
      tenant_id: tenantId,
      allocation_id: allocationId,
      skipped: linkPlan.skipped,
    });
  }

  // Identity is centralised on `profiles`, keyed by canonical phone. An
  // owner-managed tenancy is a profile *without a login* — never a tenancy
  // without a profile (ADR-136). `auth_user_id` / `password_hash` stay null
  // deliberately: that, and only that, is what "no login yet" means. The tenant
  // sets them when they accept, and it is the *same* account either way.
  let profileId: string | null = params.existingProfileId;
  if (!profileId) {
    const existingByPhone = await tx.profile.findUnique({ where: { phone } });
    if (existingByPhone) {
      // An OWNER may become a tenant of a hostel they don't own; never of the
      // hostel they DO own. `ownerId` is this tenancy's hostel's actual owner
      // (callers verified that), so this comparison is hostel-scoped. ADR-162.
      const isDifferentHostelOwner = existingByPhone.role === "OWNER" && existingByPhone.id !== ownerId;
      if (existingByPhone.role !== "TENANT" && !isDifferentHostelOwner) {
        throw new TenancyEligibilityError({
          eligible: false,
          code: "PHONE_BELONGS_TO_NON_TENANT",
          disclosure: {
            scope: existingByPhone.id === ownerId ? "OWN" : "OTHER",
            hostelName: null,
            roomNumber: null,
            tenantId: null,
          },
        });
      }
      // Reuse, never duplicate. Credentials, email and role are left exactly as
      // they are — this must not touch an account the person may already use.
      profileId = existingByPhone.id;
    } else {
      const email = resolveActivationEmail({
        profile: params.profileEmail ? { email: params.profileEmail } : null,
        invitation: params.invitationEmail ? { email: params.invitationEmail } : null,
        phone,
      });
      if (!email) {
        throw new Error("VALIDATION_ERROR: A valid mobile number is required before managing this tenant");
      }
      const createdProfile = await tx.profile.create({
        data: {
          id: crypto.randomUUID(),
          name: displayName,
          email,
          phone,
          role: "TENANT",
          is_active: true,
          password_hash: null,
          auth_user_id: null,
        },
        select: { id: true },
      });
      profileId = createdProfile.id;
    }
  }

  if (!profileId) {
    // Unreachable: the branch above either reuses, creates, or throws.
    throw new Error("INTERNAL_ERROR: could not resolve a profile for this tenancy");
  }

  return { profileId, allocationId, allocationCreated: created };
}

/**
 * "This tenancy is operationally live from now — but the tenant has NOT
 * accepted it."
 *
 * Called once, by `createInvitation`. It links the profile and the room
 * allocation (so rent generates, the room reads occupied and reminders fire
 * immediately) and then sets the tenancy `ACTIVE` / `OWNER_MANAGED` /
 * `acceptance_status = PENDING`.
 *
 * What it deliberately does NOT do (this is the whole point — see ADR-165):
 *   - it does not stamp `activation_completed_at` / `tenant_accepted_at`
 *   - it does not write a `tenant_owner_attestations` row
 *   - it does not mark the invitation `SUPERSEDED` (the caller leaves it
 *     `PENDING` so the expiry ladder, nudge cron and the "re-invite is an
 *     update" dedup all keep working, and `resolveByToken`'s ordinary success
 *     path — not a fall-through — opens the wizard for this tenant)
 *
 * The owner has no path anywhere that flips `acceptance_status` to `ACCEPTED`;
 * only `completeActivation`, run by the tenant, does that.
 */
export async function initializeActiveUnacceptedTenancy(
  params: InitializeActiveUnacceptedTenancyParams,
): Promise<InitializeActiveUnacceptedTenancyResult> {
  const { tx, tenantId, ownerId, displayName, phone } = params;

  const { profileId, allocationCreated } = await linkTenancyProfileAndAllocation(params);

  await tx.tenants.update({
    where: { id: tenantId },
    data: {
      status: "ACTIVE",
      access_mode: "OWNER_MANAGED",
      acceptance_status: "PENDING",
      display_name: displayName,
      phone_1: phone,
      profile_id: profileId,
      updated_at: new Date(),
    },
  });

  if (params.reservation) {
    await tx.tenant_invitation_reservations.update({
      where: { id: params.reservation.id },
      data: {
        status: "RELEASED",
        released_by: ownerId,
        released_at: new Date(),
        // Not "ADOPTED": nobody adopted anything. The reservation became a real
        // allocation because the invitation itself was linked to a live room.
        release_reason: "INVITE_LINKED",
        updated_at: new Date(),
      },
    });
  }

  return {
    tenant_id: tenantId,
    access_mode: "OWNER_MANAGED" as const,
    status: "ACTIVE" as const,
    acceptance_status: "PENDING" as const,
    display_name: displayName,
    allocation_created: allocationCreated,
    profile_id: profileId,
  };
}
