import crypto from "crypto";
import { prisma } from "../../../lib/db";
import { hashPassword } from "../../../lib/auth";
import { normalizeIndianPhone } from "../../../lib/utils/phone-utils";
import { frontendUrl } from "../../../lib/config/domains";
import { EmailService } from "../../../lib/services/email-service";
import { eventLog } from "../../../lib/services/event-log-service";
import { hostelBillingPreferencesService, type MaintenanceType } from "../../../lib/services/hostel-billing-preferences-service";
import { roomCapacityService } from "../../../lib/services/room-capacity-service";
import { ensureActiveAllocation } from "./tenancy-allocation";
import { onboardingFinancialsService } from "../payments/onboarding-financials-service";
import { financialPaymentFacade } from "../payments/financial-payment-facade";
import { financialService } from "../payments/financial-service";
import { selectCurrentTenancy } from "@/lib/tenancy/active-tenancy";
import { recordWhatsAppDelivery, readWhatsAppDeliveredAt } from "./invitation-delivery-trust";
import { isPhoneAlreadyProven } from "./invitation-phone-trust";
import { resolveInvitedProfile, resolveActivationEmail } from "./invited-profile-resolver";
import { initializeActiveUnacceptedTenancy } from "./owner-managed-tenancy-service";
import {
  TenancyEligibilityError,
  tenancyEligibilityService,
} from "./tenancy-eligibility-service";
import { markLeadJoinedForTenant } from "@/src/services/admissions/lead-joined-transition";

type InvitationStatus = "PENDING" | "OPENED" | "ACTIVATION_STARTED" | "ACTIVATED" | "EXPIRED" | "CANCELLED";
type ReservationReleaseReason =
  | "ACTIVATED"
  | "EXPIRED"
  | "CANCELLED"
  | "TRANSFERRED"
  /** The invitee accepted a different hostel's invitation, so this bed is free again. */
  | "JOINED_ELSEWHERE";

const ACTIVE_INVITE_STATUSES: InvitationStatus[] = ["PENDING", "OPENED", "ACTIVATION_STARTED"];
const DEFAULT_INVITE_DAYS = 7;

function normalizeEmail(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Same guard as startActivation()'s email-conflict check below: a profile
 * update must never silently reassign an email another profile already owns
 * (`profile.email` is globally unique) — that's a raw Prisma P2002, not a
 * validation error, if left unchecked. Takes `tx` so callers inside a
 * transaction see a consistent snapshot; a normal `prisma` client works too.
 */
export async function assertEmailAvailableForProfile(
  db: { profile: { findUnique: (args: { where: { email: string } }) => Promise<{ id: string } | null> } },
  targetProfileId: string,
  normalizedEmail: string,
) {
  const emailOwner = await db.profile.findUnique({ where: { email: normalizedEmail } });
  if (emailOwner && emailOwner.id !== targetProfileId) {
    throw new Error("VALIDATION_ERROR: An account with this email address already exists. Please use a different email address.");
  }
}

function moneyNumber(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function addDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Everything activation needs to know about a tenancy, in one shape.
 *
 * Extracted so the token path and the session path cannot drift: a screen that
 * renders from `rule_acceptances` or `agreements` must not work on one route
 * and quietly find `undefined` on the other. See ADR-155.
 */
import { isAwaitingTenantOnboarding, hasCompletedActivation } from "./activation-entry";

const ACTIVATION_TENANT_INCLUDE = {
  profiles: true,
  hostels: {
    include: { profiles: { select: { id: true, name: true, phone: true, email: true } } },
  },
  room_allocations: {
    where: { is_active: true, end_date: null },
    orderBy: { start_date: "desc" as const },
    take: 1,
    include: { room: true },
  },
  identification_documents: { where: { is_active: true }, orderBy: { created_at: "desc" as const } },
  rule_acceptances: { orderBy: { accepted_at: "desc" as const }, take: 5, include: { rule_version: true } },
  agreements: { orderBy: { generated_at: "desc" as const }, take: 5, include: { template: true } },
  // Presence alone is the signal: an owner attested on this tenant's behalf,
  // so the tenancy's `activation_completed_at` is adoption's, not theirs.
  // See activation-entry.ts.
  owner_attestations: { take: 1, select: { id: true } },
};

export class TenantInvitationLifecycleService {
  async getRoomCapacitySnapshot(tx: any, roomId: string) {
    return roomCapacityService.getRoomCapacitySnapshot(roomId, { tx });
  }

  private async dispatchInvitationNotification(
    invitation: any,
    tenant: any,
    room: any,
    owner: any,
    activationLink: string
  ) {
    let whatsappSent = false;
    let whatsappError: string | undefined = undefined;
    let providerMessageId: string | null = null;

    // 1. Primary: WhatsApp
    if (invitation.phone) {
      try {
        const { MetaWhatsAppProvider } = await import("../../../lib/services/notifications/providers/whatsapp/meta-provider");
        const whatsappProvider = new MetaWhatsAppProvider();
        const result = await whatsappProvider.sendInvitation({
          to: invitation.phone,
          tenantName: invitation.name,
          ownerName: owner.name || "The Owner",
          hostelName: room.hostels.name,
          roomNumber: room.room_no,
          roomRent: Number(tenant.monthly_rent),
          activationLink,
        });
        whatsappSent = true;
        providerMessageId = result.providerMessageId;
      } catch (err: any) {
        whatsappError = err?.message || String(err);
      }
    }

    // 2. Fallback: Email (only if WhatsApp failed/not sent AND email exists)
    let emailSent = false;
    let emailError: string | undefined = undefined;
    if (!whatsappSent && invitation.email) {
      try {
        const roommates = await this.getRoommateNames(room.id);
        const emailResult = await EmailService.sendInvitation({
          toEmail: invitation.email,
          tenantName: invitation.name,
          ownerName: owner.name || "The Owner",
          hostelName: room.hostels.name,
          roomNumber: room.room_no,
          roomRent: Number(tenant.monthly_rent),
          activationLink,
          advanceDeposit: Number(tenant.security_deposit),
          maintenanceCharge: Number(tenant.maintenance_charge),
          maintenanceType: tenant.maintenance_type,
          joiningDate: tenant.joined_on || undefined,
          roommates,
        });
        emailSent = Boolean(emailResult.sent);
        if (!emailResult.sent) {
          emailError = String(emailResult.error || "unknown");
        }
      } catch (err: any) {
        emailError = err?.message || String(err);
      }
    }

    return {
      whatsapp_sent: whatsappSent,
      whatsapp_error: whatsappError,
      provider_message_id: providerMessageId,
      email_sent: emailSent,
      email_error: emailError,
      needs_email: !whatsappSent && !invitation.email,
    };
  }

  /**
   * Can this phone number be invited by this owner?
   *
   * Delegates the rule to `tenancyEligibilityService`, so "one live tenancy per
   * person, and no new stay until the last one is settled" has exactly one
   * implementation.
   *
   * Two deliberate behaviours:
   *
   * - **A pending invitation from another owner does not block.** Several owners
   *   may court the same person; whichever invitation is accepted first voids the
   *   rest (`voidCompetingInvitations`). Blocking here would let any owner reserve
   *   a person by sending an invite they never accept.
   * - **The refusal reveals the hostel only when it is the asking owner's own.**
   *   This used to name another owner's hostel and tenant unconditionally, which
   *   leaks one owner's roster — and a person's address — to a competitor.
   */
  async checkTenantPhoneUniqueness(
    phone: string,
    invitingOwnerId: string | null = null
  ): Promise<{ isUnique: boolean; reason?: string; tenantName?: string; code?: string; disclosure?: unknown }> {
    const normalizedPhone = normalizeIndianPhone(phone);
    if (!normalizedPhone) {
      return { isUnique: true };
    }

    const eligibility = await tenancyEligibilityService.checkEligibilityByContact(
      { phone: normalizedPhone },
      invitingOwnerId
    );
    if (eligibility.eligible) return { isUnique: true };

    const { scope, hostelName } = eligibility.disclosure;
    const where =
      scope === "OWN" && hostelName ? `your hostel ${hostelName}` : "another property on Stayo";
    const reason =
      eligibility.code === "TENANT_HAS_ACTIVE_TENANCY"
        ? `This person is already a tenant at ${where}.`
        : `This person's previous stay at ${where} has not been settled yet.`;

    return { isUnique: false, reason, code: eligibility.code, disclosure: eligibility.disclosure };
  }

  async createInvitation(data: any, ownerId: string) {
    // The invitation is always dispatched. Tenant acceptance is mandatory
    // (ADR-165) and there is no "just add to my records without inviting"
    // path — that would be the owner standing in for the tenant's acceptance,
    // which nothing is allowed to do.
    const normalizedEmail = data.email ? normalizeEmail(data.email) : null;
    const normalizedPhone = normalizeIndianPhone(data.phone);
    const name = String(data.name || "").trim();
    const roomId = String(data.room_id || data.roomId || "").trim();
    if (!name) throw new Error("VALIDATION_ERROR: Tenant name is required");
    if (!normalizedPhone) throw new Error("VALIDATION_ERROR: Valid phone is required");
    if (!roomId) throw new Error("VALIDATION_ERROR: Room is required");

    const roomWithHostel = await prisma.rooms.findFirst({
      where: {
        id: roomId,
        is_active: true,
      },
      include: {
        hostels: true,
      },
    });

    if (!roomWithHostel) {
      throw new Error("NOT_FOUND: Room not found");
    }
    if (roomWithHostel.hostels.owner_id !== ownerId) {
      throw new Error("FORBIDDEN: Cannot invite tenant to another owner's room");
    }
    if (roomWithHostel.hostels.status === "ARCHIVED") {
      throw new Error("VALIDATION_ERROR: Cannot invite tenant to an archived hostel");
    }
    if (roomWithHostel.hostels.status === "INACTIVE") {
      throw new Error("VALIDATION_ERROR: Cannot invite tenant to an inactive hostel");
    }

    const today = startOfToday();
    const joiningDate = data.joining_date ? new Date(data.joining_date) : today;
    if (Number.isNaN(joiningDate.getTime())) throw new Error("VALIDATION_ERROR: Invalid joining date");
    const billingStartDate = joiningDate > today ? joiningDate : today;
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = data.expires_at ? new Date(data.expires_at) : addDays(DEFAULT_INVITE_DAYS);
    if (Number.isNaN(expiresAt.getTime())) throw new Error("VALIDATION_ERROR: Invalid invitation expiry");

    const owner = await prisma.profile.findUnique({ where: { id: ownerId } });
    if (!owner || owner.role !== "OWNER") throw new Error("NOT_FOUND: Owner profile not found");

    // An owner cannot invite themselves as a tenant. Deliberately explicit and
    // ahead of any DB write — the old behaviour relied on the tenancy-finalize
    // path hitting an incidental ROLE_MISMATCH (phone case) or an unhandled P2002
    // on profile.email's unique constraint (email-only case), which surfaced as a
    // raw 500 instead of a clean validation error. Compares against the same
    // normalized phone/email used everywhere else in this function, so mobile
    // stays the primary identity and a different email cannot bypass it.
    const ownerPhone = normalizeIndianPhone(owner.phone);
    const ownerEmail = normalizeEmail(owner.email);
    if ((normalizedPhone && ownerPhone === normalizedPhone) || (normalizedEmail && ownerEmail === normalizedEmail)) {
      throw new Error("VALIDATION_ERROR: You cannot invite yourself as a tenant");
    }

    // Resending your own live invitation is an update, not a new invitation, so it
    // is resolved before the eligibility check — that invitation is the reason the
    // person may already look "taken".
    const activeExisting = await prisma.tenant_invitations.findFirst({
      where: {
        owner_id: ownerId,
        status: { in: ACTIVE_INVITE_STATUSES },
        OR: [
          ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
      include: { tenant: true },
    });
    if (activeExisting) {
      return this.resendInvitation(activeExisting.id, { id: ownerId, role: "OWNER" }, data);
    }

    // One live tenancy per person, and no new stay until the previous one is
    // settled. Throws a 409 carrying an ownership-scoped disclosure, which the
    // owner's invite form renders as "already a tenant at …" — replacing the old
    // `ALREADY_EXISTS: User with this email already exists`, which told the owner
    // nothing about why their invite was refused.
    await tenancyEligibilityService.assertCanStartNewTenancyByContact(
      { email: normalizedEmail, phone: normalizedPhone },
      ownerId
    );

    const inviteDefaults = await hostelBillingPreferencesService.resolveTenantInviteDefaults(roomId, ownerId);
    const resolved = inviteDefaults.resolved_values;
    const monthlyRent = moneyNumber(data.monthly_rent, Number(resolved.monthly_rent));
    let resolvedDeposit = resolved.advance_deposit;
    if (inviteDefaults.billing_defaults.deposit_calculation_mode === "MONTHS_OF_RENT" &&
        data.advance_amount === undefined &&
        data.advance_deposit === undefined &&
        data.deposit === undefined) {
      resolvedDeposit = inviteDefaults.billing_defaults.deposit_months * monthlyRent;
    }
    const advanceDeposit = moneyNumber(data.advance_amount ?? data.advance_deposit ?? data.deposit ?? data.security_deposit, Number(resolvedDeposit));
    const maintenanceType = (data.maintenance_type || resolved.maintenance_type) as MaintenanceType;
    const maintenanceCharge = maintenanceType === "NONE"
      ? 0
      : moneyNumber(data.maintenance_amount, Number(resolved.maintenance_charge));
    if (!Number.isFinite(monthlyRent) || monthlyRent < 0) {
      throw new Error("VALIDATION_ERROR: Monthly rent cannot be negative");
    }
    if (advanceDeposit < 0) throw new Error("VALIDATION_ERROR: Deposit cannot be negative");
    if (maintenanceCharge < 0) throw new Error("VALIDATION_ERROR: Maintenance charge cannot be negative");
    const created = await prisma.$transaction(async (tx: any) => {
      // Phone-scoped mutex, same pattern as the pay_intent advisory lock in
      // payment-service.ts. The eligibility check above ran before this
      // transaction against `tenants.profile_id: null` rows, which the DB's
      // `tenants_one_live_tenancy_per_profile` partial unique index cannot
      // protect (it only applies once profile_id is bound). Without this lock,
      // two concurrent invites for the same never-before-invited phone at two
      // different hostels could both pass the pre-check before either commits.
      // Re-checking eligibility here, after the lock, closes that window: the
      // second transaction blocks until the first commits, then sees its
      // freshly-inserted tenant row and is refused.
      const invitePhoneLockKey = `tenancy_invite:${normalizedPhone}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invitePhoneLockKey})::bigint)`;
      await tenancyEligibilityService.assertCanStartNewTenancyByContact(
        { email: normalizedEmail, phone: normalizedPhone },
        ownerId,
        tx
      );

      await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
      const capacity = await this.getRoomCapacitySnapshot(tx, roomId);
      if (capacity.room.hostels.owner_id !== ownerId) {
        throw new Error("FORBIDDEN: Cannot invite tenant to another owner's room");
      }
      if (capacity.room.hostels.status === "ARCHIVED") {
        throw new Error("VALIDATION_ERROR: Cannot invite tenant to an archived hostel");
      }
      if (capacity.room.hostels.status === "INACTIVE") {
        throw new Error("VALIDATION_ERROR: Cannot invite tenant to an inactive hostel");
      }
      if (capacity.available <= 0) {
        throw new Error("CAPACITY_EXCEEDED: Room is already full including active reservations");
      }

      const tenant = await tx.tenants.create({
        data: {
          id: crypto.randomUUID(),
          profile_id: null,
          owner_id: ownerId,
          hostel_id: capacity.room.hostel_id,
          monthly_rent: monthlyRent,
          joined_on: joiningDate,
          billing_start_date: billingStartDate,
          status: "INVITED",
          security_deposit: advanceDeposit,
          maintenance_charge: maintenanceCharge,
          maintenance_type: maintenanceType,
          phone_1: normalizedPhone,
          personal_email: normalizedEmail,
          payment_frequency: data.payment_frequency || capacity.room.hostels.rent_cycle || "MONTHLY",
        },
      });

      const invitation = await tx.tenant_invitations.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenant.id,
          owner_id: ownerId,
          hostel_id: capacity.room.hostel_id,
          room_id: roomId,
          batch_id: data.batch_id || null,
          name,
          email: normalizedEmail,
          phone: normalizedPhone,
          token,
          expires_at: expiresAt,
          status: "PENDING",
          monthly_rent: monthlyRent,
          agreement_duration_months: data.agreement_duration_months !== undefined && data.agreement_duration_months !== null
            ? Number(data.agreement_duration_months)
            : (resolved.agreement_duration_months ? Number(resolved.agreement_duration_months) : 12),
          agreement_start_date: data.agreement_start_date ? new Date(data.agreement_start_date) : null,
        },
      });

      const reservation = await tx.tenant_invitation_reservations.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenant.id,
          invitation_id: invitation.id,
          owner_id: ownerId,
          hostel_id: capacity.room.hostel_id,
          room_id: roomId,
          batch_id: data.batch_id || null,
          status: "ACTIVE",
          reserved_at: new Date(),
          expires_at: expiresAt,
        },
      });

      const financials = await onboardingFinancialsService.initializeOnboardingFinancials(tx, {
        tenantId: tenant.id,
        ownerId,
        hostelId: capacity.room.hostel_id,
        joiningDate,
        monthlyRent,
        maintenanceCharge,
        maintenanceType,
      });

      if (financials.createdObligationIds.length > 0) {
        const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
        await financialLifecycleService.activatePayableObligations(tx, {
          tenantId: tenant.id,
          ownerId,
          hostelId: capacity.room.hostel_id,
          obligationIds: financials.createdObligationIds,
        });
      }

      // The tenancy is operationally live from this moment — the reservation
      // becomes a real room allocation, rent generates on schedule, the room
      // reads occupied and reminders fire — but the tenant has NOT accepted.
      // `acceptance_status` is set to PENDING and nothing else about acceptance
      // is touched: no `activation_completed_at`, no owner attestation, and the
      // invitation row stays PENDING (not SUPERSEDED) so its own token opens
      // the activation wizard through `resolveByToken`'s ordinary success path,
      // the expiry ladder / nudge cron keep seeing it, and a re-invite for the
      // same contact is resolved as an update. Only the tenant, via
      // `completeActivation`, ever moves this to ACCEPTED. See ADR-165.
      await initializeActiveUnacceptedTenancy({
        tx,
        tenantId: tenant.id,
        ownerId,
        hostelId: capacity.room.hostel_id,
        displayName: name,
        phone: normalizedPhone,
        roomId,
        joiningDate,
        existingProfileId: null,
        profileEmail: normalizedEmail,
        invitationEmail: normalizedEmail,
        reservation: { id: reservation.id },
      });

      // Money the tenant has already handed over, recorded in the same breath
      // as the invitation.
      //
      // Two situations, one mechanism. A deposit negotiated face-to-face and
      // paid in cash or over UPI at the door; and onboarding a hostel that has
      // been running for months, whose tenant is five rent cycles in and has
      // paid for them. Without this the owner had to invite, leave, find the
      // payment page, and come back — and for the second case there was
      // nothing to pay *against*, because the arrears did not exist until
      // `initializeOnboardingFinancials` learned to backfill elapsed months.
      //
      // Allocation is the real settlement engine (FIFO, ledger, receipt), not
      // a status flip, so this cannot disagree with what
      // `buildInviteSettlementPreview` showed the owner before they committed.
      let settlement: any = null;
      const paidAmount = Number(data.paid_amount || 0);
      if (paidAmount > 0) {
        if (!data.payment_method) {
          throw new Error("VALIDATION_ERROR: A payment method is required to record an amount already paid");
        }
        const owed = await financialService.getTenantDues(
          tenant.id,
          ownerId,
          capacity.room.hostel_id
        );
        const due = Number(owed?.total_due || 0);
        if (paidAmount > due + 0.01) {
          throw new Error(
            `VALIDATION_ERROR: Cannot record ₹${paidAmount.toFixed(2)} — only ₹${due.toFixed(2)} is owed`
          );
        }

        settlement = await financialPaymentFacade.receivePayment(
          tx,
          {
            tenantId: tenant.id,
            hostelId: capacity.room.hostel_id,
            amountPaid: paidAmount,
            paymentMethod: String(data.payment_method),
            referenceNumber: data.payment_reference || undefined,
            paymentDate: new Date(),
            ownerId,
            // One settlement per invitation: a double-submitted form must not
            // record the money twice.
            idempotencyKey: `invite-settle:${invitation.id}`,
            offlineRecordedBy: ownerId,
            offlineRecordedAt: new Date(),
            offlineNote: "Recorded while inviting — already paid",
          },
          crypto.randomUUID()
        );
      }

      return { tenant, invitation, reservation, room: capacity.room, financials, settlement };
    }, { timeout: 30000 });

    // Post-commit: notify (cache invalidation + SSE). Activation itself
    // already happened synchronously inside the transaction above.
    if (created.financials?.createdObligations?.length > 0) {
      const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
      financialLifecycleService.notifyActivated({
        tenantId: created.tenant.id,
        ownerId,
        hostelId: created.room.hostel_id,
        source: "invitation_onboarding",
      });
    }

    const activationLink = frontendUrl(`/activate/${created.invitation.token}`);
    const delivery = await this.dispatchInvitationNotification(
      created.invitation,
      created.tenant,
      created.room,
      owner,
      activationLink
    );

    // A successful WhatsApp send is what later lets activation skip the OTP for
    // this number — see invitation-delivery-trust. Recorded rather than
    // inferred, and only on success.
    await recordWhatsAppDelivery(created.invitation.id, delivery.whatsapp_sent);

    await eventLog.log("tenant_invited", ownerId, {
      tenant_id: created.tenant.id,
      invitation_id: created.invitation.id,
      reservation_id: created.reservation.id,
      hostel_id: created.room.hostel_id,
      room_id: created.room.id,
      whatsapp_sent: delivery.whatsapp_sent,
      whatsapp_error: delivery.whatsapp_error,
      email_sent: delivery.email_sent,
      email_error: delivery.email_error,
      needs_email: delivery.needs_email,
    }, created.tenant.id);

    return {
      tenant_id: created.tenant.id,
      invitation_id: created.invitation.id,
      reservation_id: created.reservation.id,
      email: normalizedEmail,
      phone: normalizedPhone,
      activation_link: activationLink,
      action: "INVITED",
      obligations: created.financials.createdObligations,
      ...delivery,
    };
  }

  async resendInvitation(invitationId: string, actor?: { id: string; role: string }, overrides?: any) {
    const invitation = await prisma.tenant_invitations.findUnique({
      where: { id: invitationId },
      include: {
        tenant: true,
        room: { include: { hostels: true } },
      },
    });
    if (!invitation || !invitation.tenant) throw new Error("NOT_FOUND: Invitation not found");
    if (invitation.room.hostels.status === "ARCHIVED") {
      throw new Error("VALIDATION_ERROR: Cannot resend invitation for an archived hostel");
    }
    if (invitation.room.hostels.status === "INACTIVE") {
      throw new Error("VALIDATION_ERROR: Cannot resend invitation for an inactive hostel");
    }
    if (actor?.role === "OWNER" && invitation.owner_id !== actor.id) {
      throw new Error("FORBIDDEN: You can only resend your own invitations");
    }
    // An owner-managed tenancy is ACTIVE from the moment it's invited (see
    // createInvitation) but has not been accepted — resend/edit must keep
    // serving it (adding an email after a failed WhatsApp send, correcting
    // terms) rather than treating "already ACTIVE" as the terminal state it
    // is for a tenant who genuinely self-registered. Covers both the new model
    // (`acceptance_status = PENDING`) and grandfathered rows (OWNER_MANAGED,
    // `acceptance_status = NOT_REQUIRED`).
    const tenantAlreadyOwnerManaged =
      invitation.tenant.status === "ACTIVE" && invitation.tenant.access_mode === "OWNER_MANAGED";
    // A grandfathered owner-managed tenancy (pre-ADR-165): its child invitation
    // is still created SUPERSEDED and relies on `resolveByToken`'s fall-through.
    // A new-model PENDING tenancy gets an ordinary PENDING child invitation.
    const isLegacyOwnerManaged =
      tenantAlreadyOwnerManaged && invitation.tenant.acceptance_status !== "PENDING";
    if (invitation.status === "ACTIVATED" || (invitation.tenant.status === "ACTIVE" && !tenantAlreadyOwnerManaged)) {
      throw new Error("BAD_REQUEST: Tenant is already active");
    }
    if (invitation.status === "CANCELLED") throw new Error("BAD_REQUEST: Invitation is cancelled");

    // Lock rule: Prevent edit/resend if tenant has successful/recorded payments
    const paymentsCount = await prisma.payments.count({
      where: { tenant_id: invitation.tenant_id },
    });
    if (paymentsCount > 0) {
      throw new Error("VALIDATION_ERROR: Cannot edit or resend invitation after payments have been recorded for this tenant");
    }

    // Limit rule: Prevent more than 10 invitation versions
    const versionCount = await prisma.tenant_invitations.count({
      where: { tenant_id: invitation.tenant_id },
    });
    if (versionCount >= 10) {
      throw new Error("VALIDATION_ERROR: Maximum limit of 10 invitation versions reached. Please cancel this invitation and create a fresh one.");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = addDays(DEFAULT_INVITE_DAYS);
    const updated = await prisma.$transaction(async (tx: any) => {
      // 1. Resolve target room
      const targetRoomId = overrides?.room_id || invitation.room_id;
      let targetRoom = invitation.room;
      let targetHostelId = invitation.hostel_id;

      // Track changes for logging and audit trail
      const changes: string[] = [];

      const overridesName = overrides?.name ? String(overrides.name).trim() : undefined;
      if (overridesName && overridesName !== invitation.name) {
        changes.push(`Name: "${invitation.name}" → "${overridesName}"`);
      }

      const overridesPhone = overrides?.phone ? normalizeIndianPhone(overrides.phone) : undefined;
      if (overridesPhone && overridesPhone !== invitation.phone) {
        changes.push(`Phone: "${invitation.phone || "None"}" → "${overridesPhone}"`);
      }

      const overridesEmail = overrides?.email ? normalizeEmail(overrides.email) : undefined;
      if (overridesEmail && overridesEmail !== invitation.email) {
        changes.push(`Email: "${invitation.email || "None"}" → "${overridesEmail}"`);
      }

      if (targetRoomId !== invitation.room_id) {
        await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${targetRoomId}::uuid FOR UPDATE`;
        const roomObj = await tx.rooms.findUnique({
          where: { id: targetRoomId },
          include: { hostels: true },
        });
        if (!roomObj) throw new Error("NOT_FOUND: Room not found");
        if (roomObj.hostels.status === "ARCHIVED") {
          throw new Error("VALIDATION_ERROR: Cannot move tenant to an archived hostel");
        }
        if (roomObj.hostels.status === "INACTIVE") {
          throw new Error("VALIDATION_ERROR: Cannot move tenant to an inactive hostel");
        }
        
        const currentRoomNo = invitation.room?.room_no || "Unknown";
        const nextRoomNo = roomObj?.room_no || "Unknown";
        changes.push(`Room: "${currentRoomNo}" → "${nextRoomNo}"`);
        
        targetRoom = roomObj;
        targetHostelId = roomObj.hostel_id;

        const capacity = await this.getRoomCapacitySnapshot(tx, targetRoomId);
        if (capacity.available <= 0) {
          throw new Error("CAPACITY_EXCEEDED: Target room is already full including active reservations");
        }
      }

      // 2. Handle reservation: release all old active reservations for this invitation
      await tx.tenant_invitation_reservations.updateMany({
        where: { invitation_id: invitation.id, status: "ACTIVE" },
        data: {
          status: "RELEASED",
          released_at: new Date(),
          released_by: actor?.id || invitation.owner_id,
          release_reason: targetRoomId !== invitation.room_id ? "ROOM_CHANGE" : "SUPERSEDED",
          updated_at: new Date(),
        },
      });

      const newInvitationId = crypto.randomUUID();

      // 3. Resolve overrides
      const monthlyRent = typeof overrides?.monthly_rent !== "undefined" ? Number(overrides.monthly_rent) : undefined;
      if (typeof monthlyRent !== "undefined" && monthlyRent !== Number(invitation.tenant.monthly_rent)) {
        changes.push(`Rent: "₹${Number(invitation.tenant.monthly_rent).toLocaleString('en-IN')}" → "₹${monthlyRent.toLocaleString('en-IN')}"`);
      }

      const securityDeposit = typeof overrides?.advance_amount !== "undefined"
        ? Number(overrides.advance_amount)
        : (typeof overrides?.security_deposit !== "undefined"
          ? Number(overrides.security_deposit)
          : (typeof overrides?.advance_deposit !== "undefined"
            ? Number(overrides.advance_deposit)
            : undefined));
      if (typeof securityDeposit !== "undefined" && securityDeposit !== Number(invitation.tenant.security_deposit)) {
        changes.push(`Deposit: "₹${Number(invitation.tenant.security_deposit).toLocaleString('en-IN')}" → "₹${securityDeposit.toLocaleString('en-IN')}"`);
      }

      const maintenanceCharge = typeof overrides?.maintenance_amount !== "undefined"
        ? Number(overrides.maintenance_amount)
        : (typeof overrides?.maintenance_charge !== "undefined"
          ? Number(overrides.maintenance_charge)
          : undefined);
      const maintenanceType = overrides?.maintenance_type;
      const phone = overrides?.phone;
      const email = overrides?.email;
      const paymentFrequency = overrides?.payment_frequency;
      if (paymentFrequency && paymentFrequency !== invitation.tenant.payment_frequency) {
        changes.push(`Billing Cycle: "${invitation.tenant.payment_frequency || "MONTHLY"}" → "${paymentFrequency}"`);
      }

      const agreementDuration = typeof overrides?.agreement_duration_months !== "undefined"
        ? (overrides.agreement_duration_months ? Number(overrides.agreement_duration_months) : null)
        : invitation.agreement_duration_months;
      if (typeof overrides?.agreement_duration_months !== "undefined" && overrides.agreement_duration_months !== invitation.agreement_duration_months) {
        changes.push(`Agreement Duration: "${invitation.agreement_duration_months || "None"} months" → "${overrides.agreement_duration_months || "None"} months"`);
      }

      const joiningDate = overrides?.joining_date ? new Date(overrides.joining_date) : (overrides?.joined_on ? new Date(overrides.joined_on) : undefined);
      if (joiningDate) {
        const currentJoinedOnStr = invitation.tenant.joined_on ? new Date(invitation.tenant.joined_on).toISOString().split('T')[0] : "None";
        const nextJoinedOnStr = joiningDate.toISOString().split('T')[0];
        if (currentJoinedOnStr !== nextJoinedOnStr) {
          changes.push(`Move-in Date: "${currentJoinedOnStr}" → "${nextJoinedOnStr}"`);
        }
      }

      // 4. Update profiles if profile_id exists
      if (invitation.tenant.profile_id) {
        const normalizedEmail = email ? normalizeEmail(email) : undefined;
        // A dangling invitation for this phone (found by the activeExisting
        // lookup above) can carry a profile_id from an earlier, unrelated
        // ACTIVATION_STARTED attempt — writing this invitation's email onto
        // that profile would collide with whichever profile already owns it
        // (e.g. the lead's own seeker_profile_id).
        if (normalizedEmail) {
          await assertEmailAvailableForProfile(tx, invitation.tenant.profile_id, normalizedEmail);
        }
        await tx.profile.update({
          where: { id: invitation.tenant.profile_id },
          data: {
            ...(overrides?.name ? { name: String(overrides.name).trim() } : {}),
            ...(phone ? { phone: normalizeIndianPhone(phone) } : {}),
            ...(normalizedEmail ? { email: normalizedEmail } : {}),
            updated_at: new Date(),
          },
        });
      }

      // 5. Update tenants table
      const updatedTenant = await tx.tenants.update({
        where: { id: invitation.tenant_id },
        data: {
          // A genuinely self-serve tenant has no live tenancy yet — resend
          // reopens it at INVITED, same as always. An owner-managed tenant
          // (the common case now — see createInvitation) already IS the live
          // tenancy: resend corrects its terms without undoing that rent
          // keeps generating and the room keeps reading occupied.
          ...(tenantAlreadyOwnerManaged ? {} : { status: "INVITED" }),
          activation_started_at: null,
          activation_completed_at: null,
          onboarding_last_activity_at: null,
          mobile_verified: false,
          document_verified: false,
          profile_completed: false,
          ...(typeof monthlyRent !== "undefined" ? { monthly_rent: monthlyRent } : {}),
          ...(typeof securityDeposit !== "undefined" ? { security_deposit: securityDeposit } : {}),
          ...(typeof maintenanceCharge !== "undefined" ? { maintenance_charge: maintenanceCharge } : {}),
          ...(maintenanceType ? { maintenance_type: maintenanceType } : {}),
          ...(phone ? { phone_1: normalizeIndianPhone(phone) } : {}),
          ...(email ? { personal_email: normalizeEmail(email) } : {}),
          ...(paymentFrequency ? { payment_frequency: paymentFrequency } : {}),
          ...(joiningDate ? { joined_on: joiningDate, billing_start_date: joiningDate } : {}),
          hostel_id: targetHostelId,
        },
      });

      // 5.5 Delete agreements and rules acceptances to reset onboarding progress
      await tx.agreement.deleteMany({
        where: { tenant_id: invitation.tenant_id },
      });
      await tx.tenantPolicyAcceptance.deleteMany({
        where: { tenant_id: invitation.tenant_id },
      });

      // 6. Delete old pending rent obligations that have no payments, and regenerate them
      await tx.rent_obligations.deleteMany({
        where: {
          tenant_id: invitation.tenant_id,
          obligation_type: { in: ["SECURITY_DEPOSIT", "MAINTENANCE", "RENT"] },
          status: { in: ["PENDING", "OVERDUE", "UPCOMING"] },
          payments: { none: {} },
        },
      });

      const financials = await onboardingFinancialsService.initializeOnboardingFinancials(tx, {
        tenantId: invitation.tenant_id,
        ownerId: invitation.owner_id,
        hostelId: targetHostelId,
        joiningDate: updatedTenant.joined_on || new Date(),
        maintenanceCharge: updatedTenant.maintenance_charge || 0,
        maintenanceType: updatedTenant.maintenance_type || "NONE",
      });

      if (financials.createdObligationIds.length > 0) {
        const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
        await financialLifecycleService.activatePayableObligations(tx, {
          tenantId: invitation.tenant_id,
          ownerId: invitation.owner_id,
          hostelId: targetHostelId,
          obligationIds: financials.createdObligationIds,
        });
      }

      // 7. Update parent invitation to SUPERSEDED and record change log in notes
      await tx.tenant_invitations.update({
        where: { id: invitation.id },
        data: {
          status: "SUPERSEDED",
          notes: changes.length > 0 ? `Edited: ${changes.join(", ")}` : "Superseded by new version",
          updated_at: new Date(),
        },
      });

      // 8. Create brand new child invitation version
      const updatedInvitation = await tx.tenant_invitations.create({
        data: {
          id: newInvitationId,
          tenant_id: invitation.tenant_id,
          owner_id: invitation.owner_id,
          hostel_id: targetHostelId,
          room_id: targetRoomId,
          batch_id: invitation.batch_id,
          name: overrides?.name ? String(overrides.name).trim() : invitation.name,
          phone: phone ? normalizeIndianPhone(phone) : invitation.phone,
          email: email ? normalizeEmail(email) : invitation.email,
          token,
          expires_at: expiresAt,
          // Self-serve and new-model owner-managed (`acceptance_status =
          // PENDING`) both get an ordinary PENDING child invitation — its token
          // opens the wizard through `resolveByToken`'s normal success path and
          // the expiry/nudge machinery keeps seeing it. Only a *grandfathered*
          // owner-managed tenancy (pre-ADR-165) still needs SUPERSEDED plus the
          // `resolveByToken` fall-through.
          status: isLegacyOwnerManaged ? "SUPERSEDED" : "PENDING",
          opened_at: null,
          activation_started_at: null,
          activated_at: null,
          cancelled_at: null,
          monthly_rent: typeof monthlyRent !== "undefined" ? monthlyRent : (invitation.monthly_rent ? Number(invitation.monthly_rent) : Number(invitation.tenant.monthly_rent)),
          agreement_duration_months: agreementDuration,
          agreement_start_date: typeof overrides?.agreement_start_date !== "undefined"
            ? (overrides.agreement_start_date ? new Date(overrides.agreement_start_date) : null)
            : invitation.agreement_start_date,
          parent_invitation_id: invitation.id,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // 9. Create a new reservation for the new invitation — skipped for an
      // already owner-managed tenant: they hold a real room allocation from
      // the moment they were invited (see createInvitation), not a
      // reservation, and creating one here would double-count them against
      // the room's capacity (`getRoomCapacitySnapshot` sums allocations and
      // reservations) with nothing that will ever convert or release it.
      if (!tenantAlreadyOwnerManaged) {
        await tx.tenant_invitation_reservations.create({
          data: {
            id: crypto.randomUUID(),
            tenant_id: invitation.tenant_id,
            invitation_id: newInvitationId,
            owner_id: invitation.owner_id,
            hostel_id: targetHostelId,
            room_id: targetRoomId,
            batch_id: invitation.batch_id,
            status: "ACTIVE",
            reserved_at: new Date(),
            expires_at: expiresAt,
          },
        });
      }

      return {
        updatedInvitation,
        updatedTenant,
        targetRoom,
        changes,
        versionCount,
      };
    }, { timeout: 30000 });

    // Post-commit: notify (cache invalidation + SSE). Activation itself
    // already happened synchronously inside the transaction above.
    {
      const { financialLifecycleService } = await import("../payments/financial-lifecycle-service");
      financialLifecycleService.notifyActivated({
        tenantId: invitation.tenant_id,
        ownerId: invitation.owner_id,
        hostelId: updated.targetRoom?.hostel_id || invitation.hostel_id,
        source: "invitation_resend_onboarding",
      });
    }

    const owner = await prisma.profile.findUnique({ where: { id: invitation.owner_id }, select: { name: true } });
    const activationLink = frontendUrl(`/activate/${token}`);

    const delivery = await this.dispatchInvitationNotification(
      updated.updatedInvitation,
      updated.updatedTenant,
      updated.targetRoom,
      owner || { name: "The Owner" },
      activationLink
    );

    // A resend can change the phone number, so this both sets the proof on a
    // successful send and clears a stale one from the previous number.
    await recordWhatsAppDelivery(updated.updatedInvitation.id, delivery.whatsapp_sent);

    // Automatically write to activity/system event logs
    await eventLog.log("tenant_invitation_edited", updated.updatedInvitation.owner_id, {
      tenant_id: updated.updatedInvitation.tenant_id,
      parent_invitation_id: invitation.id,
      new_invitation_id: updated.updatedInvitation.id,
      changes: updated.changes,
      message: `Owner edited invitation. Changed:\n${updated.changes.map(c => `- ${c}`).join('\n')}\nInvitation V${updated.versionCount + 1} created\nInvitation V${updated.versionCount} superseded`,
    }, updated.updatedInvitation.tenant_id);

    await eventLog.log("tenant_invitation_resent", updated.updatedInvitation.owner_id, {
      tenant_id: updated.updatedInvitation.tenant_id,
      invitation_id: updated.updatedInvitation.id,
      whatsapp_sent: delivery.whatsapp_sent,
      whatsapp_error: delivery.whatsapp_error,
      email_sent: delivery.email_sent,
      email_error: delivery.email_error,
      needs_email: delivery.needs_email,
    }, updated.updatedInvitation.tenant_id);

    return {
      message: delivery.whatsapp_sent
        ? "Invitation resent via WhatsApp"
        : delivery.email_sent
        ? "Invitation resent via Email"
        : delivery.needs_email
        ? "WhatsApp delivery failed. Email is required for fallback."
        : "Failed to resend invitation",
      action: "RESENT",
      tenant_id: updated.updatedInvitation.tenant_id,
      email: updated.updatedInvitation.email,
      phone: updated.updatedInvitation.phone,
      activation_link: activationLink,
      ...delivery,
    };
  }

  async resendInvitationByEmail(identifier: string, actor?: { id: string; role: string }, overrides?: any) {
    const isEmail = String(identifier || "").includes("@");
    const isUuid = String(identifier || "").length === 36;
    const invitation = await prisma.tenant_invitations.findFirst({
      where: {
        OR: [
          ...(isEmail ? [{ email: normalizeEmail(identifier) }] : []),
          ...(!isEmail && !isUuid ? [{ phone: normalizeIndianPhone(identifier) }] : []),
          ...(isUuid ? [{ id: identifier }, { tenant_id: identifier }] : [])
        ],
        ...(actor?.role === "OWNER" ? { owner_id: actor.id } : {}),
        status: { in: ["PENDING", "OPENED", "ACTIVATION_STARTED", "EXPIRED"] },
      },
      orderBy: { created_at: "desc" },
    });
    if (!invitation) throw new Error("NOT_FOUND: Invitation not found");
    return this.resendInvitation(invitation.id, actor, overrides);
  }

  async resolveByToken(token: string, options: { markOpened?: boolean } = {}) {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) throw new Error("VALIDATION_ERROR: Activation token is required");

    const invitation = await prisma.tenant_invitations.findUnique({
      where: { token: normalizedToken },
      include: {
        tenant: {
          include: ACTIVATION_TENANT_INCLUDE,
        },
        room: true,
        reservations: { where: { status: "ACTIVE" }, orderBy: { reserved_at: "desc" }, take: 1, include: { room: true } },
      },
    });

    if (!invitation || !invitation.tenant) {
      return this.resolveLegacyProfileToken(normalizedToken);
    }
    // Hostel status blocks every path, including the claim route below — an
    // archived/inactive hostel is not something a SUPERSEDED+OWNER_MANAGED
    // tenancy should be claimable into, so this must run before that check,
    // not after it. (Every tenancy is SUPERSEDED+OWNER_MANAGED from the
    // moment it's invited now — see createInvitation — so this ordering,
    // previously a rare edge case, is the common case.)
    if (invitation.tenant.hostels?.status === "ARCHIVED") {
      throw new Error("FORBIDDEN: Cannot activate tenant in an archived hostel");
    }
    if (invitation.tenant.hostels?.status === "INACTIVE") {
      throw new Error("FORBIDDEN: Cannot activate tenant in an inactive hostel");
    }

    // "Has the tenant personally finished onboarding?" — answered by the
    // explicit `acceptance_status` (new model) or the invitation/attestation
    // proxies (grandfathered rows), never by `tenant.status === "ACTIVE"` alone,
    // which is true for a live-but-unaccepted tenancy. See activation-entry.ts.
    const entrySubject = {
      status: invitation.tenant.status,
      activationCompletedAt: invitation.tenant.activation_completed_at,
      invitationStatus: invitation.status,
      ownerAttested: Boolean(invitation.tenant.owner_attestations?.length),
      acceptanceStatus: invitation.tenant.acceptance_status,
    };

    if (invitation.status === "SUPERSEDED") {
      // An invitation is superseded two ways: a grandfathered owner-managed
      // tenancy (pre-ADR-165: adoption, or the old auto-supersede-on-invite) or
      // a genuine replacement (e.g. a room change re-issuing the invite). Only
      // the former still has a live tenant behind it who may not have onboarded
      // themselves yet — that tenant's link must resolve into the exact same
      // activation context a never-superseded invitation gets. New-model
      // invitations are never SUPERSEDED, so this branch is legacy-only now.
      const awaitingOnboarding =
        invitation.tenant.access_mode === "OWNER_MANAGED" && isAwaitingTenantOnboarding(entrySubject);

      if (!awaitingOnboarding) {
        if (invitation.tenant.access_mode === "OWNER_MANAGED" && hasCompletedActivation(entrySubject)) {
          throw new Error("ALREADY_ACTIVE: Account already active");
        }
        throw new Error("INVALID: Activation link expired or already used");
      }
      // Falls through to the normal success path below — same as a
      // never-superseded invitation, minus the CANCELLED/EXPIRED-by-status
      // checks (a superseded invitation carries no such status of its own)
      // but still subject to the link's own expiry.
      if (invitation.expires_at < new Date() && invitation.status !== "ACTIVATION_STARTED") {
        await eventLog.log("expired_invite_rate", invitation.owner_id, { tenant_id: invitation.tenant_id, invitation_id: invitation.id }, invitation.tenant_id);
        throw new Error("EXPIRED: Invitation expired");
      }
    } else if (invitation.status === "ACTIVATED" || hasCompletedActivation(entrySubject)) {
      // Not `invitation.tenant.status === "ACTIVE"`: a new-model tenancy is
      // ACTIVE with `acceptance_status = PENDING` from the moment it's invited,
      // and its own token must open the wizard, not hit this wall.
      throw new Error("ALREADY_ACTIVE: Account already active");
    } else if (invitation.status === "CANCELLED" || invitation.tenant.status === "CANCELLED") {
      throw new Error("CANCELLED: Invitation was cancelled");
    } else if (invitation.status === "EXPIRED" || invitation.tenant.status === "EXPIRED") {
      await eventLog.log("expired_invite_rate", invitation.owner_id, { tenant_id: invitation.tenant_id, invitation_id: invitation.id }, invitation.tenant_id);
      throw new Error("EXPIRED: Invitation expired");
    } else if (invitation.expires_at < new Date() && invitation.status !== "ACTIVATION_STARTED") {
      await eventLog.log("expired_invite_rate", invitation.owner_id, { tenant_id: invitation.tenant_id, invitation_id: invitation.id }, invitation.tenant_id);
      throw new Error("EXPIRED: Invitation expired");
    }
    if (options.markOpened && invitation.status === "PENDING") {
      await prisma.tenant_invitations.update({
        where: { id: invitation.id },
        data: { status: "OPENED", opened_at: new Date(), updated_at: new Date() },
      }).catch(() => undefined);
      await eventLog.log("tenant_invitation_opened", invitation.owner_id, {
        tenant_id: invitation.tenant_id,
        invitation_id: invitation.id,
      }, invitation.tenant_id);
      invitation.status = "OPENED";
    }

    // The tenancy carries no `profile_id` until activation binds one, so this
    // used to report `profile: null` for people who demonstrably have an
    // account — every Stayo Discover seeker among them. Resolving it here means
    // activation meets them as themselves. See invited-profile-resolver.
    const resolvedProfile = await resolveInvitedProfile(invitation.tenant, invitation);

    return {
      source: "tenant_invitations",
      invitation,
      profile: invitation.tenant.profiles || resolvedProfile.profile,
      profile_source: resolvedProfile.source,
      email_conflict: resolvedProfile.conflict || null,
      whatsapp_delivered_at: await readWhatsAppDeliveredAt(invitation.id),
      tenant: invitation.tenant,
      token: normalizedToken,
    };
  }

  /**
   * Resolve the same activation subject from a session instead of a token.
   *
   * Reached only by a request that presented no token at all (see
   * `resolveActivationSubject`), which until now was a flat refusal. The
   * caller has already established *which* tenancy the session belongs to;
   * this method does not authenticate, it loads.
   *
   * The invitation-status ladder in `resolveByToken` is deliberately absent
   * here, because every rung of it asks a question about a *link* — is it
   * spent, superseded, expired. None of that bears on someone holding a
   * session. A new-model owner-managed tenancy keeps its invitation `PENDING`
   * and `acceptance_status = PENDING` until the tenant finishes; this method
   * just loads the subject for a signed-in tenant with no token at all (e.g.
   * navigating straight to `/activate` on an existing session).
   * Refusing them on link-status grounds that don't apply to a session would
   * be wrong either way.
   *
   * What does still apply is the hostel gate — an archived or inactive hostel
   * is not somewhere anyone onboards, however they arrived — and the tenancy's
   * own eligibility, which `ActivationWorkflowService` applies via
   * `canEnterActivation`. See ADR-155.
   */
  async resolveForSession(tenantId: string) {
    const id = String(tenantId || "").trim();
    if (!id) throw new Error("VALIDATION_ERROR: Tenant is required");

    const tenant = await prisma.tenants.findUnique({
      where: { id },
      include: ACTIVATION_TENANT_INCLUDE,
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenancy not found");

    if (tenant.hostels?.status === "ARCHIVED") {
      throw new Error("FORBIDDEN: Cannot activate tenant in an archived hostel");
    }
    if (tenant.hostels?.status === "INACTIVE") {
      throw new Error("FORBIDDEN: Cannot activate tenant in an inactive hostel");
    }

    // A session exists only because an account was bound to this tenancy —
    // claim writes `profile_id` before it mints one. If that is somehow not
    // true, the agreement would be signed by nobody, so refuse rather than
    // proceed with a null signatory.
    const profile = tenant.profiles || null;
    if (!profile) throw new Error("INVALID: This tenancy is not linked to an account");

    // Read-only, and never a credential: the tenancy's own invitation, when it
    // had one, carries the agreed start date and duration that the residency
    // agreement interpolates. A tenancy the owner created directly has none,
    // and every consumer of `invitation` is already null-guarded.
    const invitation = await prisma.tenant_invitations.findFirst({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: "desc" },
      include: {
        room: true,
        reservations: { where: { status: "ACTIVE" }, orderBy: { reserved_at: "desc" }, take: 1, include: { room: true } },
      },
    }).catch(() => null);

    return {
      source: "session",
      invitation,
      profile,
      profile_source: "tenancy",
      email_conflict: null,
      // Nothing was delivered over WhatsApp on this path, so there is no
      // delivery to vouch for a phone number. Null is the honest answer.
      whatsapp_delivered_at: null,
      tenant,
      token: "",
    };
  }

  async startActivation(token: string, data: any) {
    const resolved = await this.resolveByToken(token);
    const invitation = resolved.invitation;
    if (!invitation) throw new Error("INVALID: Activation link expired or already used");
    const tenant = resolved.tenant;
    const password = String(data?.password || "");
    const confirmPassword = String(data?.confirm_password || data?.confirmPassword || "");
    const primaryPhone = normalizeIndianPhone(data?.phone || data?.primary_phone || tenant.phone_1 || invitation.phone);
    if (!primaryPhone) throw new Error("VALIDATION_ERROR: Valid primary phone is required");
    if (password || confirmPassword) {
      if (password.length < 8) throw new Error("VALIDATION_ERROR: Password must be at least 8 characters");
      if (password !== confirmPassword) throw new Error("VALIDATION_ERROR: Passwords do not match");
    }

    // An existing account owns this address but could not be safely adopted —
    // its verified phone is not the one the invitation was sent to. Neither
    // adopting nor creating is correct, and only the owner can fix it.
    if ((resolved as any).email_conflict) {
      throw new Error(
        "VALIDATION_ERROR: This invitation's email address already belongs to another Stayo account. Ask the hostel to re-send the invitation with the correct email or phone number.",
      );
    }

    // Not asked for on the Identity screen any more — see resolveActivationEmail.
    const normalizedEmail = resolveActivationEmail({
      profile: resolved.profile,
      invitation,
      phone: primaryPhone,
    });
    if (!normalizedEmail) {
      throw new Error("VALIDATION_ERROR: This invitation is missing both an email address and a phone number");
    }

    // Still guarded, because this path can create a profile: the address must
    // not already belong to somebody other than the account we resolved.
    const existingWithEmail = await prisma.profile.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingWithEmail && (!resolved.profile || existingWithEmail.id !== resolved.profile.id)) {
      throw new Error("VALIDATION_ERROR: An account with this email address already exists. Please use a different email address.");
    }

    const passwordHash = password ? await hashPassword(password) : undefined;
    const now = new Date();
    const profile = await prisma.$transaction(async (tx: any) => {
      const existingProfile = resolved.profile;
      let profileRecord = existingProfile;
      if (!profileRecord) {
        profileRecord = await tx.profile.create({
          data: {
            id: crypto.randomUUID(),
            email: normalizedEmail,
            name: invitation.name,
            phone: primaryPhone,
            role: "TENANT",
            is_active: false,
            owner_id: invitation.owner_id,
            mobile_verified: true,
            phone_verified: true,
            ...(passwordHash ? { password_hash: passwordHash } : {}),
          },
        });
      } else {
        profileRecord = await tx.profile.update({
          where: { id: existingProfile.id },
          data: {
            email: normalizedEmail,
            phone: primaryPhone,
            mobile_verified: true,
            phone_verified: true,
            ...(passwordHash ? { password_hash: passwordHash } : {}),
          },
        });
      }

      // Binding the profile to this tenancy is the moment the person becomes
      // "taken". `tenants_one_live_tenancy_per_profile` would reject a second one
      // anyway, but as a raw Prisma constraint error — check first so the invitee
      // clicking a rival hostel's link gets an explanation instead.
      await tenancyEligibilityService.assertCanStartNewTenancy(
        profileRecord.id,
        invitation.owner_id,
        tx
      );

      await tx.tenants.update({
        where: { id: tenant.id },
        data: {
          profile_id: profileRecord.id,
          phone_1: primaryPhone,
          personal_email: normalizedEmail,
          mobile_verified: true,
          activation_started_at: tenant.activation_started_at || now,
          onboarding_last_activity_at: now,
          ...(data?.photo_url ? { photo_url: String(data.photo_url) } : {}),
        },
      });
      await tx.tenant_invitations.update({
        where: { id: invitation.id },
        data: {
          email: normalizedEmail,
          status: "ACTIVATION_STARTED",
          activation_started_at: invitation.activation_started_at || now,
          updated_at: now,
        },
      });
      return profileRecord;
    }, { timeout: 30000 });

    await eventLog.log("activation_started", invitation.owner_id, {
      tenant_id: tenant.id,
      invitation_id: invitation.id,
      hostel_id: invitation.hostel_id,
    }, tenant.id);
    return profile;
  }

  /**
   * Accepting one hostel's invitation withdraws the person from every other
   * hostel's, and hands those beds back.
   *
   * Several owners may invite the same person; only one can win. Without this the
   * losing rooms stay reserved until their invitations expire — beds the owner
   * cannot fill and cannot see a reason for — and the invitee is left holding
   * links that fail with a raw constraint error when clicked.
   *
   * Runs inside the activation transaction so a person is never simultaneously
   * joined here and pending elsewhere.
   */
  private async voidCompetingInvitations(
    tx: any,
    params: {
      profileId: string;
      acceptedInvitationId: string;
      acceptedTenantId: string;
      email: string | null;
      phone: string | null;
      at: Date;
    }
  ) {
    // Matched by contact, not by profile: a competing invitation's placeholder
    // `tenants` row has `profile_id: null` until that invitation's own activation
    // begins, so a profile-only match would miss every invitation not yet opened —
    // which is most of them.
    const identifiers = [
      ...(params.email ? [{ email: params.email }] : []),
      ...(params.phone ? [{ phone: params.phone }] : []),
      { tenant: { profile_id: params.profileId } },
    ];

    const competing = await tx.tenant_invitations.findMany({
      where: {
        id: { not: params.acceptedInvitationId },
        tenant_id: { not: params.acceptedTenantId },
        status: { in: ACTIVE_INVITE_STATUSES },
        OR: identifiers,
      },
      select: { id: true, owner_id: true, tenant_id: true, hostel_id: true, room_id: true },
    });
    if (competing.length === 0) return [];

    const invitationIds = competing.map((invite: any) => invite.id);
    const tenantIds = competing.map((invite: any) => invite.tenant_id);

    await tx.tenant_invitations.updateMany({
      where: { id: { in: invitationIds } },
      data: { status: "CANCELLED", updated_at: params.at },
    });

    // Free the beds. Without this the rooms stay at reduced capacity for nothing.
    await tx.tenant_invitation_reservations.updateMany({
      where: { invitation_id: { in: invitationIds }, status: "ACTIVE" },
      data: {
        status: "RELEASED",
        released_at: params.at,
        release_reason: "JOINED_ELSEWHERE" satisfies ReservationReleaseReason,
        updated_at: params.at,
      },
    });

    // The placeholder tenancy rows those invitations created must end too —
    // `tenants_one_live_tenancy_per_profile` allows only one live row per person,
    // and these never had a tenant in them.
    await tx.tenants.updateMany({
      where: { id: { in: tenantIds }, status: "INVITED" },
      data: { status: "CANCELLED", updated_at: params.at },
    });

    return competing;
  }

  async completeActivation(invitation: any, tenant: any, profile: any, paymentFrequency?: string, password?: string) {
    const completedAt = new Date();
    let voidedInvitations: any[] = [];

    await prisma.$transaction(async (tx: any) => {
      // 1. Proactive row lock on the tenant row
      const tenantRow = await tx.$queryRaw`
        SELECT id, status, joined_on, owner_id, activation_completed_at, acceptance_status,
               EXISTS(SELECT 1 FROM tenant_owner_attestations a WHERE a.tenant_id = tenants.id) AS owner_attested
        FROM tenants
        WHERE id = ${tenant.id}::uuid FOR UPDATE
      `;
      if (!tenantRow || tenantRow.length === 0) {
        throw new Error("NOT_FOUND: Tenant not found");
      }
      
      const currentTenantStatus = tenantRow[0].status;

      // 2. Idempotency guard.
      //
      // The status list below is the original one, unchanged: a tenancy in any
      // of those states has finished and this write must not run twice.
      //
      // What is new is the carve-out. `ACTIVE` used to be sufficient proof that
      // activation was complete, which is true of a tenant who activated
      // themselves — they became ACTIVE by finishing — and false of an
      // owner-managed tenancy, which is ACTIVE from the moment the owner
      // created it. A claiming tenant would have completed every onboarding
      // step and then had this write skipped without a word, leaving them
      // permanently unfinished and looped back into onboarding on every visit.
      //
      // So the skip still applies to everyone it applied to before, except a
      // tenancy the owner attested for whose tenant has not since finished.
      // See activation-entry.ts and ADR-155.
      const awaitingTenantOnboarding = isAwaitingTenantOnboarding({
        status: currentTenantStatus,
        activationCompletedAt: tenantRow[0].activation_completed_at,
        invitationStatus: invitation?.status ?? null,
        ownerAttested: Boolean(tenantRow[0].owner_attested),
        acceptanceStatus: tenantRow[0].acceptance_status,
      });
      if (
        !awaitingTenantOnboarding &&
        ["ACTIVE", "CHECKED_IN", "MOVED_IN", "MOVED_OUT"].includes(currentTenantStatus)
      ) {
        console.log(`[Lifecycle] Tenant ${tenant.id} is already in state ${currentTenantStatus}. Activation is already complete.`);
        return;
      }

      // Lock profile row
      const profileRow = await tx.$queryRaw`
        SELECT id FROM profiles 
        WHERE id = ${profile.id}::uuid FOR UPDATE
      `;
      if (!profileRow || profileRow.length === 0) {
        throw new Error("NOT_FOUND: Profile not found");
      }

      // Lock invitation row
      const inviteRow = await tx.$queryRaw`
        SELECT id, status FROM tenant_invitations 
        WHERE id = ${invitation.id}::uuid FOR UPDATE
      `;
      if (!inviteRow || inviteRow.length === 0) {
        throw new Error("NOT_FOUND: Invitation not found");
      }
      if (inviteRow[0].status === "ACTIVATED") {
        console.log(`[Lifecycle] Invitation ${invitation.id} is already activated. Skipping.`);
        return;
      }

      const reservation = await tx.tenant_invitation_reservations.findFirst({
        where: { invitation_id: invitation.id, tenant_id: tenant.id, status: "ACTIVE" },
        orderBy: { reserved_at: "desc" },
      });

      // An owner-managed tenancy already had its reservation converted into a
      // real allocation and released (release_reason "INVITE_LINKED") the moment
      // it was invited — see initializeActiveUnacceptedTenancy. There is nothing
      // left to find here for that population, by design, not by error. Fall
      // back to the tenancy's existing active allocation; only a tenancy with
      // neither a reservation nor an allocation is genuinely broken.
      let roomId: string;
      let hostelId: string;
      if (reservation) {
        // Lock reservation row
        await tx.$executeRaw`
          SELECT id FROM tenant_invitation_reservations
          WHERE id = ${reservation.id}::uuid FOR UPDATE
        `;
        roomId = reservation.room_id;
        hostelId = reservation.hostel_id;
      } else {
        const existingAllocation = await tx.roomAllocation.findFirst({
          where: { tenant_id: tenant.id, is_active: true, end_date: null },
        });
        if (!existingAllocation) throw new Error("INVALID_TRANSITION: Active room reservation is missing");
        roomId = existingAllocation.room_id;
        hostelId = existingAllocation.hostel_id;
      }

      // The room is assigned on joining, unconditionally. Deposit and maintenance
      // are ordinary dues payable after move-in, not a gate on getting a bed —
      // owners on the platform collect them on their own terms. The capacity check
      // below stays, because that is overbooking protection, not a payment gate.
      await tx.$executeRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR UPDATE`;
      await ensureActiveAllocation(tx, {
        tenantId: tenant.id,
        roomId,
        hostelId,
        startDate: tenantRow[0].joined_on || startOfToday(),
      });

      if (reservation) {
        await tx.tenant_invitation_reservations.update({
          where: { id: reservation.id },
          data: {
            status: "RELEASED",
            released_by: tenant.owner_id || invitation.owner_id,
            released_at: completedAt,
            release_reason: "ACTIVATED",
            updated_at: completedAt,
          },
        });
      }
      await tx.tenant_invitations.update({
        where: { id: invitation.id },
        data: { status: "ACTIVATED", activated_at: completedAt, updated_at: completedAt },
      });
      const passwordHash = password ? await hashPassword(password) : undefined;
      await tx.profile.update({
        where: { id: profile.id },
        data: {
          is_active: true,
          is_profile_completed: true,
          invitation_token: null,
          invitation_expires_at: null,
          ...(passwordHash ? { password_hash: passwordHash } : {}),
        },
      });
      await tx.tenants.update({
        where: { id: tenant.id },
        data: {
          status: "ACTIVE",
          // Whatever this tenancy started as, completeActivation is only ever
          // reached after the tenant has walked through ACCOUNT/RULES/
          // AGREEMENT/PROFILE themselves — that is definitionally self-serve,
          // and it is the tenant personally accepting. This is the only write
          // in the system that sets `acceptance_status = ACCEPTED` / stamps
          // `tenant_accepted_at` and the only one that flips `access_mode` back
          // off OWNER_MANAGED. `activation_completed_at` is likewise stamped
          // here and nowhere else now (ADR-165). A grandfathered NOT_REQUIRED
          // tenancy that somehow reaches here becomes ACCEPTED too — it did
          // just complete the ceremony.
          access_mode: "SELF_SERVE",
          acceptance_status: "ACCEPTED",
          tenant_accepted_at: completedAt,
          profile_completed: true,
          activation_completed_at: completedAt,
          onboarding_last_activity_at: completedAt,
          payment_frequency_effective_from: tenantRow[0].joined_on || completedAt,
          ...(paymentFrequency ? { payment_frequency: paymentFrequency } : {}),
        },
      });

      // The lead that led to this tenant is done — see markLeadJoinedForTenant's
      // doc comment for why this must share the transaction rather than run
      // after commit.
      await markLeadJoinedForTenant(tenant.id, tx);

      voidedInvitations = await this.voidCompetingInvitations(tx, {
        profileId: profile.id,
        acceptedInvitationId: invitation.id,
        acceptedTenantId: tenant.id,
        email: invitation.email ? normalizeEmail(invitation.email) : null,
        phone: invitation.phone || null,
        at: completedAt,
      });
    }, { timeout: 30000 });

    // Outside the transaction: the joiner is committed either way, and telling the
    // losing owners is not worth rolling that back.
    for (const voided of voidedInvitations) {
      await eventLog.log("invitation_voided_joined_elsewhere", voided.owner_id, {
        invitation_id: voided.id,
        tenant_id: voided.tenant_id,
        hostel_id: voided.hostel_id,
        room_id: voided.room_id,
        voided_at: completedAt.toISOString(),
      }, voided.tenant_id).catch(() => undefined);
    }

    await eventLog.log("activation_completed", invitation.owner_id, {
      tenant_id: tenant.id,
      invitation_id: invitation.id,
      hostel_id: invitation.hostel_id,
      completed_at: completedAt.toISOString(),
      duration_seconds: tenant.activation_started_at
        ? Math.max(0, Math.round((completedAt.getTime() - new Date(tenant.activation_started_at).getTime()) / 1000))
        : null,
    }, tenant.id);
  }

  async releaseReservation(reservationId: string, reason: ReservationReleaseReason, releasedBy: string) {
    if (!releasedBy) throw new Error("VALIDATION_ERROR: released_by is required");
    if (!reason) throw new Error("VALIDATION_ERROR: release_reason is required");
    const releasedAt = new Date();
    return prisma.tenant_invitation_reservations.update({
      where: { id: reservationId },
      data: {
        status: "RELEASED",
        released_by: releasedBy,
        released_at: releasedAt,
        release_reason: reason,
        updated_at: releasedAt,
      },
    });
  }

  private async getRoommateNames(roomId: string) {
    const roommates = await prisma.roomAllocation.findMany({
      where: { room_id: roomId, is_active: true, end_date: null, tenant: { status: "ACTIVE" } },
      include: { tenant: { include: { profiles: { select: { name: true } } } } },
      take: 10,
    });
    return roommates.map((item: any) => item.tenant?.profiles?.name).filter(Boolean);
  }

  private async resolveLegacyProfileToken(token: string) {
    const profile = await prisma.profile.findFirst({
      where: {
        invitation_token: token,
        invitation_expires_at: { gte: new Date() },
        role: "TENANT",
      },
      include: {
        tenants: {
          include: {
            hostels: { include: { profiles: { select: { id: true, name: true, phone: true, email: true } } } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              orderBy: { start_date: "desc" },
              take: 1,
              include: { room: true },
            },
            identification_documents: { where: { is_active: true }, orderBy: { created_at: "desc" } },
            rule_acceptances: { orderBy: { accepted_at: "desc" }, take: 5, include: { rule_version: true } },
            agreements: { orderBy: { generated_at: "desc" }, take: 5, include: { template: true } },
          },
        },
      },
    });
    // `selectCurrentTenancy`, not `selectLiveTenancy`: the CANCELLED/EXPIRED
    // branches below exist to explain a dead link, and a live-only filter would
    // hide exactly the rows they describe.
    const currentTenancy: any = selectCurrentTenancy(profile?.tenants);
    if (!profile || !currentTenancy) throw new Error("INVALID: Activation link expired or already used");
    if (currentTenancy.hostels?.status === "ARCHIVED") {
      throw new Error("FORBIDDEN: Cannot activate tenant in an archived hostel");
    }
    if (currentTenancy.hostels?.status === "INACTIVE") {
      throw new Error("FORBIDDEN: Cannot activate tenant in an inactive hostel");
    }
    if (currentTenancy.status === "ACTIVE") throw new Error("ALREADY_ACTIVE: Account already active");
    if (currentTenancy.status === "CANCELLED") throw new Error("CANCELLED: Invitation was cancelled");
    if (currentTenancy.status === "EXPIRED") throw new Error("EXPIRED: Invitation expired");
    return {
      source: "legacy_profile",
      invitation: null,
      profile,
      tenant: currentTenancy,
      token,
    };
  }
}

export const tenantInvitationLifecycleService = new TenantInvitationLifecycleService();
