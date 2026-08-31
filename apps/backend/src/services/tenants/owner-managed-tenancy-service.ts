import crypto from "crypto";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { ensureActiveAllocation } from "./tenancy-allocation";
import { planObligationLinking } from "./obligation-linking";
import { resolveActivationEmail } from "./invited-profile-resolver";

export interface AdoptParams {
  tenantId: string;
  ownerId: string;
  hostelId: string;
  displayName?: string;
  note?: string;
  ip?: string | null;
}

export interface AdoptResult {
  tenant_id: string;
  access_mode: "OWNER_MANAGED";
  status: "ACTIVE";
  display_name: string;
  allocation_created: boolean;
}

export interface FinalizeOwnerManagedTenancyParams {
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
  /** The invitation this tenancy came from, if any — marked SUPERSEDED so a late claim routes correctly. */
  invitationId: string | null;
  note?: string;
  ip?: string | null;
}

/**
 * The write side of "this tenancy is owner-managed, starting now": link or
 * create the profile by canonical phone, convert the held reservation into a
 * real room allocation (via `ensureActiveAllocation`'s overbooking guard),
 * flip the tenancy to `ACTIVE` / `OWNER_MANAGED`, and record the owner's
 * attestation.
 *
 * Shared by two callers that reach this exact state from different starting
 * points: `adopt()` below (an owner taking over a tenancy that sat `INVITED`
 * and unclaimed) and `tenant-invitation-lifecycle-service.ts`'s
 * `createInvitation()` (every new invitation, immediately — see its comment
 * for why owner-managed is no longer a choice). Both need identical
 * profile-linking, allocation and attestation logic; this function is that
 * logic, extracted so neither duplicates it. Callers own their own validation
 * (name/room presence, tenancy-state guards) and the room-row lock — this
 * function assumes both are already satisfied.
 */
export async function finalizeOwnerManagedTenancy(
  params: FinalizeOwnerManagedTenancyParams,
): Promise<AdoptResult> {
  const { tx, tenantId, ownerId, hostelId, displayName, phone, roomId, joiningDate } = params;

  const { created, allocationId } = await ensureActiveAllocation(tx, {
    tenantId,
    roomId,
    hostelId,
    startDate: joiningDate,
  });

  // Bind obligations raised before this allocation existed.
  //
  // `createInvitation` writes the tenancy's obligations — including the
  // months a mid-year adoption backfills — while only a *reservation* exists,
  // so they carry `allocation_id: null`. Every duplicate guard downstream is
  // allocation-scoped: the monthly rent cron matches on
  // `allocation_id: { in: [...] }` and `upsertObligation` on
  // `allocation_id + rent_month + obligation_type`. `NULL` matches neither, so
  // both were blind to the backfilled months and raised them a second time —
  // a tenant adopted mid-year saw two identical RENT rows for the current
  // month, ₹8,000 they did not owe, on the first screen they ever opened.
  //
  // Binding them here makes the existing checks — and the
  // `(allocation_id, rent_month, obligation_type)` unique index — cover these
  // rows too, rather than redefining "duplicate" in four places. See ADR-149.
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
    // Pre-existing duplicates from before this fix. Left unbound rather than
    // failing the invitation over historical data — an unbound row is exactly
    // what it was a moment ago, and cancelling an obligation is an owner's
    // decision, not a side effect of adoption.
    logger.warn("tenancy.obligation_link_skipped", {
      tenant_id: tenantId,
      allocation_id: allocationId,
      skipped: linkPlan.skipped,
    });
  }

  // Identity is centralised on `profiles`, keyed by canonical phone. An
  // owner-managed tenancy is a profile *without a login* — never a tenancy
  // without a profile.
  //
  // The earlier design stored the name on `tenants.display_name` and left
  // `profile_id` null. That orphaned the tenancy from the person: every
  // duplicate guard in this system resolves a phone to a profile and then
  // inspects that profile's tenancies, so an adopted tenancy was invisible
  // to all of them. In production one phone ended up with three tenancies
  // in one hostel — a second invite was accepted two minutes after the
  // adoption, because `checkEligibilityByContact` could not see it.
  //
  // `auth_user_id` and `password_hash` stay null deliberately: that, and
  // only that, is what "no login yet" means. The tenant sets them when they
  // claim the tenancy, and it is the *same* account either way.
  let profileId = params.existingProfileId;
  if (!profileId) {
    const existingByPhone = await tx.profile.findUnique({ where: { phone } });
    if (existingByPhone) {
      // An OWNER may become a tenant of a hostel they don't own (Hostel A
      // owner → Hostel B tenant is allowed); they may never become a tenant
      // of the hostel they DO own. `ownerId` here is always this tenancy's
      // hostel's actual owner (callers already verified that), so comparing
      // the matched profile's id against it is hostel-scoped, not a blanket
      // "owners can never be tenants" rule.
      const isDifferentHostelOwner = existingByPhone.role === "OWNER" && existingByPhone.id !== ownerId;
      if (existingByPhone.role !== "TENANT" && !isDifferentHostelOwner) {
        const message = existingByPhone.role === "OWNER"
          ? "ROLE_MISMATCH: You already own this hostel and cannot become its tenant"
          : "ROLE_MISMATCH: This phone number belongs to a different kind of Stayo account";
        throw new Error(message);
      }
      // Reuse, never duplicate. Credentials, email and role are left exactly
      // as they are — this must not touch an account the person may already
      // be using.
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

  await tx.tenants.update({
    where: { id: tenantId },
    data: {
      status: "ACTIVE",
      access_mode: "OWNER_MANAGED",
      display_name: displayName,
      phone_1: phone,
      profile_id: profileId,
      activation_completed_at: new Date(),
      updated_at: new Date(),
    },
  });

  await tx.tenant_owner_attestations.create({
    data: {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      hostel_id: hostelId,
      attested_by: ownerId,
      attested_ip: params.ip || null,
      note: params.note || null,
    },
  });

  if (params.reservation) {
    await tx.tenant_invitation_reservations.update({
      where: { id: params.reservation.id },
      data: {
        status: "RELEASED",
        released_by: ownerId,
        released_at: new Date(),
        release_reason: "ADOPTED",
        updated_at: new Date(),
      },
    });
  }

  if (params.invitationId) {
    await tx.tenant_invitations.update({
      where: { id: params.invitationId },
      data: { status: "SUPERSEDED", updated_at: new Date() },
    });
  }

  return {
    tenant_id: tenantId,
    access_mode: "OWNER_MANAGED" as const,
    status: "ACTIVE" as const,
    display_name: displayName,
    allocation_created: created,
  };
}

/**
 * Adopting a tenant who ignored their invitation.
 *
 * This is NOT the owner-side "Activate" button that was deliberately deleted
 * (see InvitedTenantProfileView.tsx:44-47). That button claimed registration
 * had happened. This records that it did not: the tenancy becomes ACTIVE and
 * OWNER_MANAGED, and the owner's assertion is stored as an attestation, never
 * as a TenantPolicyAcceptance.
 *
 * The invitation is marked SUPERSEDED rather than cancelled precisely so a
 * late-clicking tenant can still act on that link. `resolveByToken`
 * (`tenant-invitation-lifecycle-service.ts`) distinguishes the two SUPERSEDED
 * cases: for one whose tenancy is still `OWNER_MANAGED` (this path), it
 * throws the distinct `CLAIM_REQUIRED` code instead of `INVALID`, so the
 * caller can route the tenant into the claim flow (`tenancy-claim-service.ts`)
 * against this exact tenancy rather than erroring. A SUPERSEDED invitation
 * whose tenancy was edited/replaced by other means (room change, resend)
 * still throws `INVALID` as before — SUPERSEDED alone was never the signal;
 * `OWNER_MANAGED` is.
 *
 * Name resolution deliberately does NOT use `resolveTenantName` — that helper
 * falls back to the literal string "Tenant" when no name is known anywhere,
 * which is the right behavior for addressing a reminder message but the wrong
 * behavior for persisting an identity: it would silently write "Tenant" as
 * someone's `display_name` and nothing downstream would ever catch it, since
 * every later check only tests for non-empty. Here, when no name can be
 * resolved from an explicit param, the linked profile, or the invitation, we
 * refuse to proceed instead of persisting a placeholder.
 *
 * By the time this is commonly reachable, most invitations are already
 * `ACTIVE` / `OWNER_MANAGED` from the moment they were created (see
 * `createInvitation`) — the guard below refuses those with `CONFLICT` rather
 * than re-adopting them. This path remains for tenancies that are genuinely
 * still `INVITED`: historical data from before that change, and any other
 * caller that legitimately creates a tenancy without going through
 * `createInvitation`.
 */
export const ownerManagedTenancyService = {
  async adopt(params: AdoptParams): Promise<AdoptResult> {
    const { tenantId, ownerId, hostelId } = params;

    return prisma.$transaction(async (tx: any) => {
      const tenant = await tx.tenants.findFirst({
        where: { id: tenantId, owner_id: ownerId, hostel_id: hostelId },
        select: {
          id: true,
          status: true,
          access_mode: true,
          display_name: true,
          phone_1: true,
          personal_email: true,
          profile_id: true,
          joined_on: true,
          hostel_id: true,
          profiles: { select: { name: true, phone: true } },
          tenant_invitations: {
            where: { status: "PENDING" },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true, name: true, phone: true, email: true, room_id: true },
          },
        },
      });

      if (!tenant) throw new Error("NOT_FOUND: Tenant not found in this hostel");
      if (tenant.status === "ACTIVE" && tenant.access_mode === "OWNER_MANAGED") {
        throw new Error("CONFLICT: Tenant is already managed by you");
      }
      if (tenant.status !== "INVITED") {
        throw new Error(`CONFLICT: Only an invited tenant can be adopted (status: ${tenant.status})`);
      }

      const displayName =
        (params.displayName || "").trim() ||
        (tenant.profiles?.name || "").trim() ||
        (tenant.tenant_invitations[0]?.name || "").trim();
      if (!displayName) {
        throw new Error("VALIDATION_ERROR: A name is required before managing this tenant");
      }

      const phone = normalizeIndianPhone(tenant.profiles?.phone || tenant.phone_1);
      if (!phone) {
        throw new Error("VALIDATION_ERROR: A valid mobile number is required before managing this tenant");
      }

      const reservation = await tx.tenant_invitation_reservations.findFirst({
        where: { tenant_id: tenant.id, status: "ACTIVE" },
        orderBy: { reserved_at: "desc" },
        select: { id: true, room_id: true, hostel_id: true },
      });
      const roomId = reservation?.room_id ?? tenant.tenant_invitations[0]?.room_id;
      if (!roomId) throw new Error("VALIDATION_ERROR: No room is reserved for this tenant");

      await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;

      return finalizeOwnerManagedTenancy({
        tx,
        tenantId: tenant.id,
        ownerId,
        hostelId: tenant.hostel_id,
        displayName,
        phone,
        roomId,
        joiningDate: tenant.joined_on || new Date(),
        existingProfileId: tenant.profile_id,
        profileEmail: tenant.personal_email,
        invitationEmail: tenant.tenant_invitations[0]?.email ?? null,
        reservation: reservation ? { id: reservation.id } : null,
        invitationId: tenant.tenant_invitations[0]?.id ?? null,
        note: params.note,
        ip: params.ip,
      });
    });
  },
};
