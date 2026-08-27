import crypto from "crypto";
import { prisma } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { ensureActiveAllocation } from "./tenancy-allocation";

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
 * The invitation is marked SUPERSEDED rather than cancelled. Today that does
 * NOT let a late-clicking tenant claim this tenancy: the activation-token
 * lookup (`tenant-invitation-lifecycle-service.ts`, `resolveByToken`) throws
 * "INVALID: Activation link expired or already used" for any SUPERSEDED
 * invitation, same as it would for a cancelled one — so the stale link is a
 * dead end either way. SUPERSEDED was chosen over CANCELLED only to keep the
 * status distinct for reporting; it is not (yet) a claim mechanism. Wiring an
 * actual "claim this tenancy" path for a tenant who shows up later is
 * unbuilt Phase 2 work — whoever picks it up needs to decide whether
 * SUPERSEDED should short-circuit to this tenancy instead of erroring, or
 * whether claiming should be a separate flow entirely.
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
          joined_on: true,
          hostel_id: true,
          profiles: { select: { name: true, phone: true } },
          tenant_invitations: {
            where: { status: "PENDING" },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true, name: true, phone: true, room_id: true },
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

      await tx.tenants.update({
        where: { id: tenant.id },
        data: {
          status: "ACTIVE",
          access_mode: "OWNER_MANAGED",
          display_name: displayName,
          phone_1: phone,
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
