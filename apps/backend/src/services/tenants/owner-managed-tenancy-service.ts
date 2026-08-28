import crypto from "crypto";
import { prisma } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { ensureActiveAllocation } from "./tenancy-allocation";
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

      const { created } = await ensureActiveAllocation(tx, {
        tenantId: tenant.id,
        roomId,
        hostelId: tenant.hostel_id,
        startDate: tenant.joined_on || new Date(),
      });

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
      let profileId = tenant.profile_id as string | null;
      if (!profileId) {
        const existingByPhone = await tx.profile.findUnique({ where: { phone } });
        if (existingByPhone) {
          if (existingByPhone.role !== "TENANT") {
            throw new Error(
              "ROLE_MISMATCH: This phone number belongs to a different kind of Stayo account"
            );
          }
          // Reuse, never duplicate. Credentials, email and role are left exactly
          // as they are — adopting a tenancy must not touch an account the
          // person may already be using.
          profileId = existingByPhone.id;
        } else {
          const email = resolveActivationEmail({
            profile: tenant.personal_email ? { email: tenant.personal_email } : null,
            invitation: tenant.tenant_invitations[0]?.email
              ? { email: tenant.tenant_invitations[0].email }
              : null,
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
        where: { id: tenant.id },
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
          tenant_id: tenant.id,
          hostel_id: tenant.hostel_id,
          attested_by: ownerId,
          attested_ip: params.ip || null,
          note: params.note || null,
        },
      });

      if (reservation) {
        await tx.tenant_invitation_reservations.update({
          where: { id: reservation.id },
          data: {
            status: "RELEASED",
            released_by: ownerId,
            released_at: new Date(),
            release_reason: "ADOPTED",
            updated_at: new Date(),
          },
        });
      }

      if (tenant.tenant_invitations[0]) {
        await tx.tenant_invitations.update({
          where: { id: tenant.tenant_invitations[0].id },
          data: { status: "SUPERSEDED", updated_at: new Date() },
        });
      }

      return {
        tenant_id: tenant.id,
        access_mode: "OWNER_MANAGED" as const,
        status: "ACTIVE" as const,
        display_name: displayName,
        allocation_created: created,
      };
    });
  },
};
