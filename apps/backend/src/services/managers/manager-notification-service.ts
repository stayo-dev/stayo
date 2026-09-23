/**
 * WhatsApp delivery for manager (platform staff) invitations.
 *
 * Until now `manager-invitation-service` emailed the activation link and
 * nothing else. Email to a staff member who is being onboarded by phone is
 * the slowest channel available; both templates below were approved in the
 * Stayo WABA on 2026-09-21 specifically to close that gap.
 *
 * Delivery policy matches `platform-lead-notification-service`: route through
 * `whatsAppTemplateDeliveryService` so every send is idempotent (via
 * `whatsapp_logs.idempotency_key`) and leaves an auditable row, and never
 * throw into the caller's critical path — a WhatsApp outage must not stop a
 * manager being created.
 */
import { getLogger } from "../../../lib/logger";
import { whatsAppTemplateDeliveryService } from "../../../lib/services/notifications/whatsapp-template-delivery";
import {
  adminInvitationTemplateLanguage,
  adminInvitationTemplateName,
  buildAdminInvitationPayload,
  buildAdminInvitationReminderPayload,
  type AdminInvitationTemplateKey,
  type TemplatePayload,
} from "../../../lib/services/notifications/providers/whatsapp/admin-invitation-template-contracts";
import { inviteRoleLabel } from "./manager-invite-labels";

const logger = getLogger("manager.notifications");

export type ManagerNotificationResult = { sent: boolean; error?: string };

export class ManagerNotificationService {
  private async dispatch(options: {
    key: AdminInvitationTemplateKey;
    phone: string;
    /**
     * A thunk, not a value: building the payload can throw (a blank token
     * fails `requireToken`). Evaluating it inside the try is what keeps that
     * throw from escaping a method documented as never throwing.
     */
    payload: () => TemplatePayload;
    idempotencyKey: string;
  }): Promise<ManagerNotificationResult> {
    const templateName = adminInvitationTemplateName(options.key);
    try {
      const payload = options.payload();
      const result = await whatsAppTemplateDeliveryService.send({
        phone: options.phone,
        templateName,
        bodyParameters: payload.bodyParameters,
        buttonParameters: payload.buttonParameters,
        idempotencyKey: options.idempotencyKey,
        languageCode: adminInvitationTemplateLanguage(options.key),
      });
      if (result.skipped) {
        logger.info("manager.invitation.whatsapp_skipped", { template: templateName, key: options.key });
        return { sent: false };
      }
      return { sent: true };
    } catch (error: any) {
      const message = String(error?.message || error);
      // Loud, and named: an unapproved or renamed template is the expected
      // failure here, and a bare provider error says nothing about which.
      logger.error("manager.invitation.whatsapp_failed", {
        template: templateName,
        key: options.key,
        error: message,
      });
      return { sent: false, error: message };
    }
  }

  /**
   * `stayo_admin_invitation`. The activation token rides in the URL button,
   * never the body — the body is what a forwarded screenshot would show.
   */
  async sendInvitation(input: {
    phone: string;
    managerName: string;
    inviterName: string;
    expiryDays: number;
    activationToken: string;
  }): Promise<ManagerNotificationResult> {
    return this.dispatch({
      key: "INVITATION",
      phone: input.phone,
      payload: () =>
        buildAdminInvitationPayload({
          adminName: input.managerName,
          titleLabel: inviteRoleLabel("MANAGER"),
          inviterName: input.inviterName,
          expiryDays: input.expiryDays,
          activationToken: input.activationToken,
        }),
      // Keyed on the token: a resend mints a new one and must be allowed to
      // send again, while a retry of the same send must not.
      idempotencyKey: `manager_invitation:${input.activationToken}`,
    });
  }

  /**
   * `stayo_admin_invitation_reminder`. Sent against a token that is still
   * live, so it deliberately does NOT mint a new one — the point is that the
   * link already in their chat still works.
   */
  async sendInvitationReminder(input: {
    phone: string;
    managerName: string;
    hoursRemaining: number;
    activationToken: string;
  }): Promise<ManagerNotificationResult> {
    return this.dispatch({
      key: "INVITATION_REMINDER",
      phone: input.phone,
      payload: () =>
        buildAdminInvitationReminderPayload({
          adminName: input.managerName,
          hoursRemaining: input.hoursRemaining,
          activationToken: input.activationToken,
        }),
      /**
       * Keyed on the token AND the hour bucket. Keying on the token alone
       * would let one reminder per invitation ever be sent; including the
       * hour lets an admin nudge again later without the idempotency guard
       * silently swallowing it.
       */
      idempotencyKey: `manager_invitation_reminder:${input.activationToken}:${Math.floor(
        input.hoursRemaining
      )}`,
    });
  }
}

export const managerNotificationService = new ManagerNotificationService();
