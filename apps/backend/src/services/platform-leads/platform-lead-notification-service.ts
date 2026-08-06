import { getLogger } from "../../../lib/logger";
import { eventLog } from "../../../lib/services/event-log-service";
import { whatsAppTemplateDeliveryService } from "../../../lib/services/notifications/whatsapp-template-delivery";
import {
  buildAccountActivatedPayload,
  buildInvitationPayload,
  buildLeadReceivedPayload,
  buildLeadRejectedPayload,
  buildOnboardingCompletePayload,
  platformLeadTemplateLanguage,
  platformLeadTemplateName,
  type PlatformLeadTemplateKey,
  type TemplatePayload,
} from "../../../lib/services/notifications/providers/whatsapp/platform-lead-template-contracts";

const logger = getLogger("platform-lead.notifications");

export type NotifiableLead = {
  id: string;
  name: string;
  phone: string;
  tracking_token: string;
};

/**
 * Every owner-acquisition funnel WhatsApp send, in one place.
 *
 * Delivery policy, uniform across all five: route through
 * whatsAppTemplateDeliveryService so each send is idempotent (via
 * whatsapp_logs.idempotency_key) and leaves an auditable row, and — with
 * the single exception of the activation invite — never throw into the
 * caller's critical path. A WhatsApp outage must not stop a lead being
 * created, an account being activated, or a hostel going live.
 */
export class PlatformLeadNotificationService {
  private async dispatch(options: {
    key: PlatformLeadTemplateKey;
    phone: string;
    payload: TemplatePayload;
    idempotencyKey: string;
    ownerId?: string;
  }): Promise<{ sent: boolean; error?: string }> {
    const templateName = platformLeadTemplateName(options.key);
    try {
      const result = await whatsAppTemplateDeliveryService.send({
        phone: options.phone,
        templateName,
        bodyParameters: options.payload.bodyParameters,
        buttonParameters: options.payload.buttonParameters,
        idempotencyKey: options.idempotencyKey,
        ownerId: options.ownerId,
        languageCode: platformLeadTemplateLanguage(options.key),
      });
      if (result.skipped) {
        logger.info("platform_lead.notification.skipped", { template: templateName, key: options.key });
        return { sent: false };
      }
      return { sent: true };
    } catch (error: any) {
      // Loud, with the template name — templates that do not exist in Meta
      // yet are the expected failure here, and a bare provider error gives
      // no clue which one.
      const message = String(error?.message || error);
      logger.error("platform_lead.notification.failed", {
        template: templateName,
        key: options.key,
        error: message,
      });
      return { sent: false, error: message };
    }
  }

  /** Fire-and-forget acknowledgement, sent the moment an enquiry is submitted. */
  async sendLeadReceived(lead: NotifiableLead): Promise<void> {
    const result = await this.dispatch({
      key: "LEAD_RECEIVED",
      phone: lead.phone,
      payload: buildLeadReceivedPayload({ ownerName: lead.name, trackingToken: lead.tracking_token }),
      idempotencyKey: `lead_received:${lead.id}`,
    });
    await eventLog
      .log(result.sent ? "LEAD_RECEIVED_NOTIFIED" : "LEAD_RECEIVED_NOTIFY_FAILED", null, {
        lead_id: lead.id,
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }

  /**
   * The one send whose outcome the caller acts on: approveLead() holds the
   * lead at APPROVED when this fails, so an admin can retry rather than the
   * lead silently sitting with an undelivered link.
   */
  async sendInvitation(
    lead: NotifiableLead,
    activationToken: string,
    expiryDays: number
  ): Promise<{ whatsapp_sent: boolean; whatsapp_error?: string }> {
    const result = await this.dispatch({
      key: "INVITATION",
      phone: lead.phone,
      payload: buildInvitationPayload({ ownerName: lead.name, expiryDays, activationToken }),
      // Keyed on the token, not the lead — a re-approval issues a new token
      // and must be allowed to send again.
      idempotencyKey: `lead_invitation:${activationToken}`,
    });
    return { whatsapp_sent: result.sent, whatsapp_error: result.error };
  }

  /** Fire-and-forget. Fired after real owner-signup completes. */
  async sendAccountActivated(profileId: string, ownerName: string, phone: string): Promise<void> {
    const result = await this.dispatch({
      key: "ACCOUNT_ACTIVATED",
      phone,
      payload: buildAccountActivatedPayload({ ownerName }),
      idempotencyKey: `owner_account_activated:${profileId}`,
      ownerId: profileId,
    });
    await eventLog
      .log(result.sent ? "owner_account_activated_notified" : "owner_account_activated_notify_failed", profileId, {
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }

  /** Fire-and-forget. Fired when the hostel goes live. */
  async sendOnboardingComplete(lead: NotifiableLead, hostelName: string): Promise<void> {
    const result = await this.dispatch({
      key: "ONBOARDING_COMPLETE",
      phone: lead.phone,
      payload: buildOnboardingCompletePayload({ ownerName: lead.name, hostelName }),
      idempotencyKey: `lead_onboarding_complete:${lead.id}`,
    });
    await eventLog
      .log(result.sent ? "LEAD_LIVE_NOTIFIED" : "LEAD_LIVE_NOTIFY_FAILED", null, {
        lead_id: lead.id,
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }

  /** Fire-and-forget. Fired only by the explicit reject action, never by a plain LOST write. */
  async sendLeadRejected(lead: NotifiableLead, reason: string): Promise<void> {
    const result = await this.dispatch({
      key: "LEAD_REJECTED",
      phone: lead.phone,
      payload: buildLeadRejectedPayload({ ownerName: lead.name, reason }),
      idempotencyKey: `lead_rejected:${lead.id}`,
    });
    await eventLog
      .log(result.sent ? "LEAD_REJECTED_NOTIFIED" : "LEAD_REJECTED_NOTIFY_FAILED", null, {
        lead_id: lead.id,
        error: result.error?.slice(0, 500),
      })
      .catch(() => {});
  }
}

export const platformLeadNotificationService = new PlatformLeadNotificationService();
