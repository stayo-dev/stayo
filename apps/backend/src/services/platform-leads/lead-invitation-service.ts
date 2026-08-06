import crypto from "crypto";
import { prisma } from "../../../lib/db";
import { frontendUrl } from "../../../lib/config/domains";
import { EmailService } from "../../../lib/services/email-service";
import { eventLog } from "../../../lib/services/event-log-service";
import { platformLeadNotificationService } from "./platform-lead-notification-service";

/**
 * Owner-acquisition funnel, phase 2: admin-approve a `platform_leads` row →
 * generate a single-use activation token → send it (WhatsApp, email
 * fallback) → the owner opens the link, completes the real onboarding
 * wizard, and the lead's status auto-advances as real events happen.
 *
 * Mirrors tenant-invitation-lifecycle-service.ts's token/expiry/dispatch
 * pattern (crypto.randomBytes token, separate from the row id, WhatsApp
 * then email fallback) without sharing its code — a lead has no
 * tenant/hostel/room context yet, so reusing that service directly would
 * mean faking those relations.
 */

const DEFAULT_INVITE_DAYS = 7;
// APPROVED is included so a lead whose send failed (e.g. email/WhatsApp
// provider error) can be retried — it means "approved, not yet
// successfully delivered," not "already delivered." A successful send
// always moves the lead to INVITE_SENT, which is not retryable this way.
const APPROVABLE_STATUSES = ["NEW", "UNDER_REVIEW", "APPROVED"];

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function addDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export class LeadInvitationService {
  /**
   * Approve a lead: generate + persist a token, send the activation link,
   * and — only on a successful send — advance status to INVITE_SENT. If
   * neither channel succeeds, the lead is left at APPROVED so the admin can
   * see the send failed and retry, rather than silently losing the lead.
   */
  async approveLead(leadId: string) {
    const lead = await prisma.platform_leads.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error("NOT_FOUND: Lead not found");
    if (!APPROVABLE_STATUSES.includes(lead.status)) {
      throw new Error(`INVALID_TRANSITION: Lead is already ${lead.status} — cannot approve again`);
    }

    await prisma.platform_leads.update({ where: { id: leadId }, data: { status: "APPROVED", updated_at: new Date() } });
    await eventLog.log("LEAD_APPROVED", null, { lead_id: leadId, hostel_name: lead.hostel_name });

    const token = generateToken();
    const expiresAt = addDays(DEFAULT_INVITE_DAYS);
    await prisma.platform_lead_invitations.create({
      data: { lead_id: leadId, token, status: "PENDING", expires_at: expiresAt },
    });

    const activationLink = frontendUrl(`/owner-invite/${token}`);
    const delivery = await this.dispatchActivationNotification(leadId, lead, activationLink, token);

    if (delivery.whatsapp_sent || delivery.email_sent) {
      await prisma.platform_leads.update({ where: { id: leadId }, data: { status: "INVITE_SENT", updated_at: new Date() } });
      await eventLog.log("LEAD_INVITE_SENT", null, {
        lead_id: leadId,
        whatsapp_sent: delivery.whatsapp_sent,
        email_sent: delivery.email_sent,
      });
    }

    const updated = await prisma.platform_leads.findUnique({ where: { id: leadId } });
    return { lead: updated, activationLink, ...delivery };
  }

  private async dispatchActivationNotification(
    leadId: string,
    lead: { name: string; hostel_name: string; phone: string; google_email: string | null; tracking_token: string },
    activationLink: string,
    activationToken: string
  ) {
    let whatsappSent = false;
    let whatsappError: string | undefined;

    if (lead.phone) {
      const result = await platformLeadNotificationService.sendInvitation(
        { id: leadId, name: lead.name, phone: lead.phone, tracking_token: lead.tracking_token },
        activationToken,
        DEFAULT_INVITE_DAYS
      );
      whatsappSent = result.whatsapp_sent;
      whatsappError = result.whatsapp_error;
    }

    let emailSent = false;
    let emailError: string | undefined;
    if (!whatsappSent && lead.google_email) {
      try {
        const emailResult = await EmailService.sendOwnerActivation({
          toEmail: lead.google_email,
          ownerName: lead.name,
          hostelName: lead.hostel_name,
          activationLink,
        });
        emailSent = Boolean(emailResult.sent);
        if (!emailResult.sent) emailError = String(emailResult.error || "unknown");
      } catch (err: any) {
        emailError = err?.message || String(err);
      }
    }

    return {
      whatsapp_sent: whatsappSent,
      whatsapp_error: whatsappError,
      email_sent: emailSent,
      email_error: emailError,
      needs_email: !whatsappSent && !lead.google_email,
    };
  }

  /**
   * Resolve a token to its invitation + lead, applying the same
   * unknown/expired/already-used guards `tenants/activate/context` uses.
   * On a valid PENDING lookup, flips to OPENED (idempotent — only the
   * first open logs an event).
   */
  async getInvitationContext(token: string) {
    const invitation = await prisma.platform_lead_invitations.findUnique({ where: { token } });
    if (!invitation) throw new Error("INVALID: Activation link is invalid");
    if (invitation.status === "ACTIVATED") throw new Error("ALREADY_ACTIVE: This invitation has already been used");
    if (invitation.status === "CANCELLED") throw new Error("CANCELLED: This invitation was cancelled");
    if (invitation.expires_at < new Date()) {
      if (invitation.status !== "EXPIRED") {
        await prisma.platform_lead_invitations.update({ where: { id: invitation.id }, data: { status: "EXPIRED", updated_at: new Date() } });
      }
      throw new Error("EXPIRED: This activation link has expired");
    }

    const lead = await prisma.platform_leads.findUnique({ where: { id: invitation.lead_id } });
    if (!lead) throw new Error("INVALID: Activation link is invalid");

    if (invitation.status === "PENDING") {
      await prisma.platform_lead_invitations.update({ where: { id: invitation.id }, data: { status: "OPENED", updated_at: new Date() } });
      await eventLog.log("LEAD_INVITE_OPENED", null, { lead_id: lead.id });
    }

    return {
      name: lead.name,
      hostel_name: lead.hostel_name,
      phone: lead.phone,
      google_email: lead.google_email,
      city: lead.city,
    };
  }

  /**
   * Called from the real owner-signup flow when it was reached via a lead
   * activation link. Single-use is enforced here, server-side, inside the
   * real signup's success path — not trusted to the frontend having called
   * things in the right order.
   */
  async activateInvitationForOwner(token: string, profileId: string) {
    const invitation = await prisma.platform_lead_invitations.findUnique({ where: { token } });
    if (!invitation) throw new Error("INVALID: Activation link is invalid");
    if (invitation.status === "ACTIVATED") throw new Error("ALREADY_ACTIVE: This invitation has already been used");
    if (invitation.status === "CANCELLED") throw new Error("CANCELLED: This invitation was cancelled");
    if (invitation.expires_at < new Date()) throw new Error("EXPIRED: This activation link has expired");

    const updated = await prisma.platform_lead_invitations.updateMany({
      where: { id: invitation.id, status: { in: ["PENDING", "OPENED"] } },
      data: { status: "ACTIVATED", updated_at: new Date() },
    });
    if (updated.count !== 1) throw new Error("ALREADY_ACTIVE: This invitation has already been used");

    await prisma.platform_leads.update({
      where: { id: invitation.lead_id },
      data: { status: "OWNER_ACTIVATED", converted_owner_id: profileId, updated_at: new Date() },
    });
    await eventLog.log("LEAD_OWNER_ACTIVATED", profileId, { lead_id: invitation.lead_id, profile_id: profileId });
  }

  /** Called right after a new hostel is created — never blocks hostel creation on failure. */
  async markHostelCreated(ownerId: string) {
    try {
      const lead = await prisma.platform_leads.findFirst({
        where: { converted_owner_id: ownerId, status: "OWNER_ACTIVATED" },
      });
      if (!lead) return;
      await prisma.platform_leads.update({ where: { id: lead.id }, data: { status: "HOSTEL_CREATED", updated_at: new Date() } });
      await eventLog.log("LEAD_HOSTEL_CREATED", ownerId, { lead_id: lead.id });
    } catch (err) {
      console.error("[lead-invitation-service.markHostelCreated] non-fatal", err);
    }
  }

  /** Called once the wizard's full floor/room publish sequence finishes. */
  async markLive(token: string) {
    const invitation = await prisma.platform_lead_invitations.findUnique({ where: { token } });
    if (!invitation) return;
    const lead = await prisma.platform_leads.findUnique({ where: { id: invitation.lead_id } });
    if (!lead || lead.status !== "HOSTEL_CREATED") return;
    await prisma.platform_leads.update({ where: { id: lead.id }, data: { status: "LIVE", updated_at: new Date() } });
    await eventLog.log("LEAD_LIVE", lead.converted_owner_id, { lead_id: lead.id });

    // Fire-and-forget — the hostel is already live; a WhatsApp failure must
    // not make it look otherwise.
    void platformLeadNotificationService
      .sendOnboardingComplete(
        { id: lead.id, name: lead.name, phone: lead.phone, tracking_token: lead.tracking_token },
        lead.hostel_name
      )
      .catch((err) => console.error("[lead-invitation-service.markLive] notify failed", err));
  }
}

export const leadInvitationService = new LeadInvitationService();
