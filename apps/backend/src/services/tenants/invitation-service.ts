import { prisma } from "../../../lib/db";
import { hashPassword } from "../../../lib/auth";
import crypto from "crypto";
import { eventSystem } from "../../../lib/events";
import { EmailService } from "../../../lib/services/email-service";
import { getLogger } from "../../../lib/logger";
import { allocationReconciliationService } from "../../../lib/services/allocation-reconciliation-service";
import { hostelBillingPreferencesService, type MaintenanceType } from "../../../lib/services/hostel-billing-preferences-service";
import { eventLog } from "../../../lib/services/event-log-service";
import { frontendUrl } from "../../../lib/config/domains";
import { roomCapacityService } from "../../../lib/services/room-capacity-service";
import { tenantInvitationLifecycleService } from "./tenant-invitation-lifecycle-service";
import { selectCurrentTenancy } from "@/lib/tenancy/active-tenancy";

const logger = getLogger("invitation-service");

function tokenFingerprint(token: string) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 12);
}

function mapAllocationConstraintError(err: any): Error {
  const msg = String(err?.message || err || "");
  if (err?.code === "P2002" || msg.includes("idx_room_allocations_active_tenant_unique")) {
    return new Error("VALIDATION_ERROR: Tenant already has an active allocation");
  }
  return err instanceof Error ? err : new Error(msg);
}

export class InvitationService {
  async inviteTenant(data: any, ownerId: string) {
    return tenantInvitationLifecycleService.createInvitation(data, ownerId);
  }

  async inviteTenantLegacy(data: any, ownerId: string) {
    const { email, name, phone, room_id } = data;

    // ── Resolve financial defaults from hostel preferences ────────
    // Phase 2: prefs resolved from room.hostels after room fetch (below)

    // ── Resolve joining date + billing start ─────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const joiningDate = data.joining_date ? new Date(data.joining_date) : today;
    const billingStartDate = joiningDate > today ? joiningDate : today;

    const normalizedEmail = String(email || "").trim().toLowerCase();
    logger.info(`Starting invitation process for email: ${normalizedEmail} by owner: ${ownerId}`);
    
    // 1. Duplicate check
    const existingProfile = await prisma.profile.findUnique({
      where: { email: normalizedEmail },
      include: { tenants: true },
    });
    if (existingProfile) {
      if (
        existingProfile.role === "TENANT" &&
        existingProfile.owner_id === ownerId &&
        selectCurrentTenancy(existingProfile.tenants)?.status === "INVITED"
      ) {
        logger.info(`Existing INVITED tenant found for ${normalizedEmail}; converting invite to resend.`);
        return this.resendInvitation(normalizedEmail, { id: ownerId, role: "OWNER" }, {
          name, phone, room_id, monthly_rent: data.monthly_rent,
        });
      }
      logger.warn(`Attempted to invite existing email: ${normalizedEmail}`);
      throw new Error("ALREADY_EXISTS: User with this email already exists");
    }

    // 2. Room and Owner check
    const room = await prisma.rooms.findFirst({
      where: { id: room_id, hostels: { owner_id: ownerId, status: "ACTIVE" } },
      include: {
        hostels: true,
        room_allocations: {
          where: { is_active: true },
          include: { tenant: { include: { profiles: { select: { name: true } } } } },
        },
      },
    });
    if (!room) throw new Error("NOT_FOUND: Target room not found");
    if (!room.hostels) throw new Error("NOT_FOUND: Associated hostel not found");
    const capacity = await roomCapacityService.getRoomCapacitySnapshot(room.id, { ownerId });
    if (capacity.available <= 0) {
      throw new Error("CAPACITY_EXCEEDED: Room is already at full capacity");
    }

    // Resolve invitation defaults from the selected room's hostel. These values
    // are copied into Tenant as immutable billing snapshots for future history.
    const inviteDefaults = await hostelBillingPreferencesService.resolveTenantInviteDefaults(room_id, ownerId);
    const resolved = inviteDefaults.resolved_values;
    const monthlyRent = Number(data.monthly_rent ?? resolved.monthly_rent);
    let resolvedDeposit = resolved.advance_deposit;
    if (inviteDefaults.billing_defaults.deposit_calculation_mode === "MONTHS_OF_RENT" && data.advance_amount === undefined) {
      resolvedDeposit = inviteDefaults.billing_defaults.deposit_months * monthlyRent;
    }
    const advance_amount = Number(data.advance_amount ?? resolvedDeposit);
    const maintenance_type = (data.maintenance_type || resolved.maintenance_type) as MaintenanceType;
    const maintenance_amount = maintenance_type === "NONE"
      ? 0
      : Number(data.maintenance_amount ?? resolved.maintenance_charge);

    if (!Number.isFinite(monthlyRent) || monthlyRent < 0) {
      throw new Error("VALIDATION: Monthly rent cannot be negative");
    }
    if (!Number.isFinite(advance_amount) || advance_amount < 0) {
      throw new Error("VALIDATION: Advance deposit must be zero or greater");
    }
    if (!Number.isFinite(maintenance_amount) || maintenance_amount < 0) {
      throw new Error("VALIDATION: Maintenance charge must be zero or greater");
    }
    if (!["MONTHLY", "ONE_TIME", "NONE"].includes(maintenance_type)) {
      throw new Error("VALIDATION: Invalid maintenance type");
    }

    const owner = await prisma.profile.findUnique({ where: { id: ownerId } });
    if (!owner) throw new Error("NOT_FOUND: Owner profile not found");

    // Roommate names for the invite email
    const roommates = (room.room_allocations || [])
      .map((a: any) => a.tenant?.profiles?.name)
      .filter(Boolean) as string[];

    // 3. Generate Token (7 days)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 4. Atomic: Profile + Tenant + Allocation + Initial Obligations
    const { obligationEngine } = await import("../../../src/services/payments/obligation-engine");

    let createdBundle: { profile: any; tenant: any; obligations: string[]; allocationId: string };
    try {
      createdBundle = await prisma.$transaction(async (tx: any) => {
        const profile = await tx.profile.create({
          data: {
            id: crypto.randomUUID(),
            email: normalizedEmail,
            name,
            phone,
            role: "TENANT",
            is_active: false,
            owner_id: ownerId,
            invitation_token: token,
            invitation_expires_at: expiresAt,
          },
        });

      const tenant = await tx.tenants.create({
        data: {
          id: crypto.randomUUID(),
          profile_id: profile.id,
          owner_id: ownerId,
          monthly_rent: monthlyRent,
          joined_on: joiningDate,
          billing_start_date: billingStartDate,
          status: "INVITED",
          advance_deposit:    advance_amount,
          maintenance_charge: maintenance_amount,
          maintenance_type,
          hostel_id: room.hostels.id, // Phase 2: write-through hostel_id
        } as any,
      });

      const allocation = await tx.roomAllocation.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenant.id,
          room_id,
          start_date: joiningDate,
          is_active: true,
          hostel_id: room.hostels.id, // Phase 2: write-through hostel_id
        },
      });

      // ── Financial obligations (ADVANCE + one-time MAINTENANCE + current-month RENT) ──
      const created = await obligationEngine.createInitialObligations(tx, {
        tenantId: tenant.id,
        allocationId: allocation.id,
        ownerId,
        hostelId: room.hostels.id,
        joiningDate,
        billingStartDate,
        monthlyRent,
        createRent: joiningDate <= billingStartDate,
        advanceDeposit: advance_amount,
        maintenanceCharge: maintenance_amount,
        maintenanceType: maintenance_type,
      });

      if (created.length > 0) {
        // createInitialObligations returns obligation TYPE names, not IDs —
        // re-query the rows it just wrote (same rent_month anchor it uses
        // internally: first-of-joining-month, UTC) within this same
        // transaction before activating them.
        const rentMonth = new Date(Date.UTC(joiningDate.getFullYear(), joiningDate.getMonth(), 1));
        const createdRows = await tx.rent_obligations.findMany({
          where: { allocation_id: allocation.id, rent_month: rentMonth },
          select: { id: true },
        });
        if (createdRows.length > 0) {
          const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
          await financialLifecycleService.activatePayableObligations(tx, {
            tenantId: tenant.id,
            ownerId,
            hostelId: room.hostels.id,
            obligationIds: createdRows.map((r: any) => r.id),
          });
        }
      }

        return { profile, tenant, obligations: created, allocationId: allocation.id };
      });
    } catch (err: any) {
      throw mapAllocationConstraintError(err);
    }
    const { profile: newProfile, tenant: newTenant, obligations, allocationId } = createdBundle;

    logger.info(`Created profile ${newProfile.id}, tenant ${newTenant.id} [INVITED], obligations: [${obligations.join(", ") || "none"}]`);

    // Post-commit: notify (cache invalidation + SSE). Activation itself
    // already happened synchronously inside the transaction above.
    if (obligations.length > 0) {
      const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
      financialLifecycleService.notifyActivated({
        tenantId: newTenant.id,
        ownerId,
        hostelId: room.hostels.id,
        source: "invitation_legacy_onboarding",
      });
    }

    await allocationReconciliationService.reconcileAllocation(allocationId).catch((err: any) => {
      logger.error("reconcile_after_invite_failed", {
        allocation_id: allocationId,
        tenant_id: newTenant.id,
        error: String(err?.message || err),
      });
    });

    // 5. Log Activity
    await eventSystem.trigger("tenant_created", {
      tenant_id: newTenant.id,
      email: normalizedEmail,
      owner_id: ownerId,
      creator_id: ownerId,
    });

    // 6. Send enhanced invitation email
    const activationLink = frontendUrl(`/activate/${token}`);

    const emailResult = await EmailService.sendInvitation({
      toEmail: normalizedEmail,
      tenantName: name,
      ownerName: owner.name || "The Owner",
      hostelName: room.hostels.name,
      roomNumber: room.room_no,
      roomRent: monthlyRent,
      activationLink,
      advanceDeposit: advance_amount,
      maintenanceCharge: maintenance_amount,
      maintenanceType: maintenance_type,
      joiningDate,
      roommates,
      prefs: { ...inviteDefaults.billing_defaults, maintenance_type },
    });
    if (!emailResult.sent) {
      logger.error(`Failed to send invitation email to ${normalizedEmail}: ${String(emailResult.error || "unknown")}`);
      return {
        tenant_id: newTenant.id,
        email: normalizedEmail,
        activation_link: activationLink,
        action: "INVITED",
        obligations,
        email_sent: false,
        email_error: String(emailResult.error || "unknown"),
      };
    }
    logger.info(`Successfully queued invitation email for ${normalizedEmail}`);

    return {
      tenant_id: newTenant.id,
      email: normalizedEmail,
      activation_link: activationLink,
      action: "INVITED",
      obligations,
      email_sent: true,
    };
  }

  async activateTenant(token: string, password: string) {
    logger.info("Delegating account activation to unified activation workflow", { token_fingerprint: tokenFingerprint(token) });
    const { activationWorkflowService } = await import("./activation-workflow-service");
    return await activationWorkflowService.mutate(
      token,
      "ACTIVATE",
      { password, confirm_password: password },
      { ip: "127.0.0.1", userAgent: "Legacy API Activation Path" }
    );
  }

  async validateActivationToken(token: string) {
    const resolved = await tenantInvitationLifecycleService.resolveByToken(token);
    return {
      valid: true,
      email: resolved.profile?.email || resolved.invitation?.email,
      name: resolved.profile?.name || resolved.invitation?.name,
    };
  }

  async validateActivationTokenLegacy(token: string) {
    const profile = await prisma.profile.findFirst({
      where: {
        invitation_token: token,
        invitation_expires_at: { gte: new Date() },
      },
      select: {
        id: true,
        email: true,
        name: true,
        tenants: {
          select: { id: true, status: true, created_at: true },
        },
      },
    });

    if (!profile || selectCurrentTenancy(profile.tenants)?.status !== "INVITED") {
      throw new Error("INVALID: Activation link expired or already used");
    }

    return {
      valid: true,
      email: profile.email,
      name: profile.name,
    };
  }

  /**
   * `identifier` is an email, a phone, an invitation id or a tenant id —
   * `resendInvitationByEmail` resolves all four. The parameter name is
   * historical.
   */
  async resendInvitation(
    email: string,
    actor?: { id: string; role: string },
    overrides?: {
      name?: string;
      phone?: string;
      /**
       * Adds (or corrects) the address the email fallback uses. This is what
       * lets the owner rescue a `needs_email` invitation from the invite
       * wizard's result screen without starting over — the lifecycle service
       * writes it onto the invitation and re-dispatches.
       */
      email?: string;
      room_id?: string;
      monthly_rent?: number;
    }
  ) {
    return tenantInvitationLifecycleService.resendInvitationByEmail(email, actor, overrides);
  }

  async resendInvitationLegacy(
    email: string,
    actor?: { id: string; role: string },
    overrides?: {
      name?: string;
      phone?: string;
      room_id?: string;
      monthly_rent?: number;
    }
  ) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    logger.info(`Resending invitation for email: ${normalizedEmail}`);
    // 1. Find the tenant by email
    const profile = await prisma.profile.findUnique({
      where: { email: normalizedEmail },
      include: { tenants: true },
    });
    const currentTenancy: any = selectCurrentTenancy(profile?.tenants);
    if (!profile || !currentTenancy) {
      logger.warn(`Resend failed: User not found for email ${normalizedEmail}`);
      throw new Error("NOT_FOUND: User not found");
    }
    const tenantDetails = currentTenancy;

    if (actor?.role === "OWNER" && profile.owner_id !== actor.id) {
      logger.warn(`Owner ${actor.id} attempted resend for foreign tenant ${normalizedEmail}`);
      throw new Error("FORBIDDEN: You can only resend invitations for your own tenants");
    }

    if (currentTenancy.status !== "INVITED") {
      logger.warn(`Resend failed: Tenant ${normalizedEmail} is not in INVITED state.`);
      throw new Error("BAD_REQUEST: Tenant is already active or left");
    }

    // Optional metadata updates when resend is triggered from invite flow.
    const roomIdOverride = overrides?.room_id ? String(overrides.room_id) : undefined;
    if (overrides?.name || typeof overrides?.phone !== "undefined" || typeof overrides?.monthly_rent !== "undefined" || roomIdOverride) {
      try {
        await prisma.$transaction(async (tx: any) => {
          if (overrides?.name || typeof overrides?.phone !== "undefined") {
            await tx.profile.update({
              where: { id: profile.id },
              data: {
                ...(overrides?.name ? { name: overrides.name } : {}),
                ...(typeof overrides?.phone !== "undefined" ? { phone: overrides.phone } : {}),
              },
            });
          }

          if (typeof overrides?.monthly_rent !== "undefined") {
            await tx.tenants.update({
              where: { id: tenantDetails.id },
              data: { monthly_rent: Number(overrides.monthly_rent) },
            });
          }

          if (roomIdOverride) {
            const capacity = await roomCapacityService.getRoomCapacitySnapshot(roomIdOverride, { tx });
            const targetRoom = capacity.room;
            if (!targetRoom || !targetRoom.hostels) {
              throw new Error("NOT_FOUND: Target room not found");
            }
            if (profile.owner_id && targetRoom.hostels.owner_id !== profile.owner_id) {
              throw new Error("FORBIDDEN: Cannot assign room from another owner");
            }
            
            // Only check capacity if we're actually changing rooms
            const activeAllocation = await tx.roomAllocation.findFirst({
              where: { tenant_id: tenantDetails.id, is_active: true },
            });
            if (!activeAllocation || activeAllocation.room_id !== roomIdOverride) {
              if (capacity.available <= 0) {
                throw new Error("CAPACITY_EXCEEDED: Target room is already at full capacity");
              }
            }

            if (activeAllocation) {
              await tx.roomAllocation.update({
                where: { id: activeAllocation.id },
                data: { room_id: roomIdOverride, hostel_id: targetRoom.hostels.id, start_date: new Date() },
              });
            } else {
              await tx.roomAllocation.create({
                data: {
                  id: crypto.randomUUID(),
                  tenant_id: tenantDetails.id,
                  room_id: roomIdOverride,
                  hostel_id: targetRoom.hostels.id,
                  start_date: new Date(),
                  is_active: true,
                },
              });
            }
          }
        });
      } catch (err: any) {
        throw mapAllocationConstraintError(err);
      }
      if (roomIdOverride) {
        await allocationReconciliationService.reconcileTenant(tenantDetails.id).catch((err: any) => {
          logger.error("reconcile_after_resend_room_override_failed", {
            tenant_id: tenantDetails.id,
            room_id: roomIdOverride,
            error: String(err?.message || err),
          });
        });
      }
    }

    // Additional details needed for email
    const allocation = await prisma.roomAllocation.findFirst({
      where: { tenant_id: tenantDetails.id, is_active: true },
      include: { room: { include: { hostels: true } } },
    });

    if (!allocation || !allocation.room || !allocation.room.hostels) {
      logger.error(`Could not find active allocation/room/hostel for resend to ${normalizedEmail}`);
      throw new Error("INTERNAL_ERROR: Cannot resend, missing allocation details.");
    }
    
    const owner = await prisma.profile.findUnique({ where: { id: profile.owner_id! }});
    if (!owner) {
      logger.error(`Could not find owner ${profile.owner_id} for resend to ${normalizedEmail}`);
      throw new Error("INTERNAL_ERROR: Cannot resend, missing owner details.");
    }

    // 2. Generate new token (7 days)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const activationLink = frontendUrl(`/activate/${token}`);

    await prisma.profile.update({
      where: { id: profile.id },
      data: {
        invitation_token: token,
        invitation_expires_at: expiresAt,
      },
    });

    const emailResult = await EmailService.sendInvitation({
      toEmail: profile.email,
      tenantName: profile.name,
      ownerName: owner.name,
      hostelName: allocation.room.hostels.name,
      roomNumber: allocation.room.room_no,
      roomRent: Number(tenantDetails.monthly_rent),
      activationLink,
    });
    if (!emailResult.sent) {
      logger.error(`Failed to resend invitation email to ${normalizedEmail}: ${String(emailResult.error || "unknown")}`);
      return {
        message: "Invitation updated, but email delivery failed",
        action: "RESENT",
        email: normalizedEmail,
        activation_link: activationLink,
        email_sent: false,
        email_error: String(emailResult.error || "unknown"),
      };
    }
    
    logger.info(`Successfully resent invitation to ${normalizedEmail}`);

    return {
      message: "Invitation resent successfully",
      action: "RESENT",
      email: normalizedEmail,
      activation_link: activationLink,
      email_sent: true,
    };
  }

  async updateInvitation(
    tenantId: string,
    ownerId: string,
    data: {
      email: string;
      name: string;
      phone?: string;
      room_id: string;
      monthly_rent: number;
      joining_date?: string;
      payment_frequency?: string;
      advance_amount?: number;
      maintenance_amount?: number;
      maintenance_type?: string;
      agreement_duration_months?: number;
      agreement_start_date?: string;
    }
  ) {
    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: ownerId },
      include: {
        payments: { select: { id: true }, take: 1 },
      },
    });

    if (!tenant) throw new Error("NOT_FOUND: Tenant invitation not found");
    if (tenant.status !== "INVITED") {
      throw new Error("VALIDATION: Invitation can be edited only before tenant activation");
    }
    if (tenant.payments.length > 0) {
      throw new Error("VALIDATION: Invitation cannot be edited after payment activity exists");
    }

    // Delegate the update and resend logic to the lifecyle service to ensure consistency (reservations, obligations, token rotation, delivery)
    return tenantInvitationLifecycleService.resendInvitationByEmail(
      tenantId,
      { id: ownerId, role: "OWNER" },
      data
    );
  }
}

export const invitationService = new InvitationService();
