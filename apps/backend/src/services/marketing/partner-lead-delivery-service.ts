/**
 * Delivering a tenant enquiry to a marketplace partner — the off-platform
 * hostel owner behind a `PLATFORM_LISTED` listing.
 *
 * The loop: Stayo lists a hostel for coverage -> students enquire -> the
 * first few enquiries reach the owner free and prove the demand is real ->
 * the next one is held, and telling them it exists is the argument for
 * joining -> they claim the listing and inherit everything held.
 *
 * Never throws into the caller. An enquiry is already committed by the time
 * this runs, and losing it because the partner side failed would be the
 * wrong trade — the same rule the platform-lead block beside it follows.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { whatsAppTemplateDeliveryService } from "@/lib/services/notifications/whatsapp-template-delivery";
import {
  buildEnquiryLockedPayload,
  buildNewEnquiryPayload,
  isPartnerTemplateApproved,
  partnerTemplateLanguage,
  partnerTemplateName,
  type PartnerTemplateKey,
  type TemplatePayload,
} from "@/lib/services/notifications/providers/whatsapp/partner-template-contracts";
import { canMessagePartner } from "./partner-consent";
import { decideDelivery } from "./partner-quota";

const logger = getLogger("partner.lead-delivery");

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export type EnquiryContext = {
  hostelId: string;
  hostelName: string;
  visitorLeadId: string;
  studentName: string;
  /** Free text as the student wrote it, or null. Never invented. */
  moveIn?: string | null;
};

export type DeliveryOutcome =
  | { outcome: "NO_PARTNER" }
  | { outcome: "BLOCKED"; reason: string }
  | { outcome: "DUPLICATE" }
  | { outcome: "DELIVERED"; deliveryId: string; sequence: number }
  | { outcome: "HELD"; deliveryId: string }
  | { outcome: "ERROR"; error: string };

export class PartnerLeadDeliveryService {
  /**
   * Called once per enquiry on a Stayo-authored listing. Safe to call for
   * any hostel: a listing with no consented partner simply does nothing.
   */
  async deliverEnquiry(enquiry: EnquiryContext): Promise<DeliveryOutcome> {
    try {
      const listing = await prisma.partner_listings.findUnique({
        where: { hostel_id: enquiry.hostelId },
        include: { partner: true },
      });
      if (!listing) return { outcome: "NO_PARTNER" };

      const guard = canMessagePartner(listing.partner);
      if (!guard.ok) {
        logger.info("partner.delivery.blocked", {
          listing_id: listing.id,
          reason: guard.reason,
        });
        return { outcome: "BLOCKED", reason: guard.reason };
      }

      /**
       * `visitor_lead_id` is unique, so re-enquiring updates the existing
       * `visitor_leads` row rather than creating one and must not earn the
       * partner a second message — nor burn a second free enquiry.
       */
      const already = await prisma.partner_lead_deliveries.findUnique({
        where: { visitor_lead_id: enquiry.visitorLeadId },
        select: { id: true },
      });
      if (already) return { outcome: "DUPLICATE" };

      // Confirmed deliveries only. See partner-quota.ts for why an accepted
      // but undelivered send must not count.
      const deliveredCount = await prisma.partner_lead_deliveries.count({
        where: { partner_listing_id: listing.id, state: "SENT" },
      });
      const decision = decideDelivery({
        deliveredCount,
        freeQuota: listing.free_quota,
      });

      const token = generateToken();
      const delivery = await prisma.partner_lead_deliveries.create({
        data: {
          partner_listing_id: listing.id,
          visitor_lead_id: enquiry.visitorLeadId,
          delivery_token: token,
          state: decision.action === "DELIVER" ? "PENDING" : "HELD",
        },
        select: { id: true },
      });

      if (decision.action === "DELIVER") {
        const sent = await this.dispatch({
          key: "NEW_ENQUIRY",
          phone: listing.partner.phone,
          idempotencyKey: `partner_enquiry:${delivery.id}`,
          payload: () =>
            buildNewEnquiryPayload({
              ownerName: listing.partner.name,
              hostelName: enquiry.hostelName,
              studentName: enquiry.studentName,
              moveIn: enquiry.moveIn ?? null,
              deliveredCount: decision.sequence,
              freeQuota: listing.free_quota,
              deliveryToken: token,
            }),
        });
        await this.recordSend(delivery.id, sent);
        return { outcome: "DELIVERED", deliveryId: delivery.id, sequence: decision.sequence };
      }

      /**
       * "That is {{3}} students this month" — the approved copy says *this
       * month*, so this counts the calendar month rather than the lifetime
       * total. A lifetime figure here would make the message say something
       * untrue.
       */
      const enquiriesThisMonth = await prisma.partner_lead_deliveries.count({
        where: { partner_listing_id: listing.id, created_at: { gte: startOfMonth() } },
      });

      const sent = await this.dispatch({
        key: "ENQUIRY_LOCKED",
        phone: listing.partner.phone,
        idempotencyKey: `partner_locked:${delivery.id}`,
        payload: () =>
          buildEnquiryLockedPayload({
            ownerName: listing.partner.name,
            hostelName: enquiry.hostelName,
            enquiriesThisMonth,
            freeQuota: listing.free_quota,
            // The activation link carries THIS enquiry's token, not the
            // partner's portal token: the page can then name the student
            // they are unlocking, and the click is attributable to the
            // enquiry that changed their mind.
            activationToken: token,
          }),
      });
      await this.recordSend(delivery.id, sent);
      return { outcome: "HELD", deliveryId: delivery.id };
    } catch (error: any) {
      const message = String(error?.message || error);
      logger.error("partner.delivery.failed", {
        hostel_id: enquiry.hostelId,
        visitor_lead_id: enquiry.visitorLeadId,
        error: message,
      });
      return { outcome: "ERROR", error: message };
    }
  }

  private async dispatch(options: {
    key: PartnerTemplateKey;
    phone: string;
    payload: () => TemplatePayload;
    idempotencyKey: string;
  }): Promise<{ sent: boolean; providerMessageId?: string | null; error?: string }> {
    const templateName = partnerTemplateName(options.key);

    // An unapproved template cannot be sent. Saying so here, by name, beats
    // a provider error that does not identify which one.
    if (!isPartnerTemplateApproved(options.key)) {
      logger.error("partner.template.not_approved", { template: templateName, key: options.key });
      return { sent: false, error: `Template ${templateName} is not approved in Meta yet` };
    }

    try {
      const result = await whatsAppTemplateDeliveryService.send({
        phone: options.phone,
        templateName,
        languageCode: partnerTemplateLanguage(options.key),
        idempotencyKey: options.idempotencyKey,
        ...options.payload(),
      });
      return { sent: !result.skipped, providerMessageId: result.providerMessageId ?? null };
    } catch (error: any) {
      const message = String(error?.message || error);
      logger.error("partner.template.send_failed", {
        template: templateName,
        key: options.key,
        error: message,
      });
      return { sent: false, error: message };
    }
  }

  /**
   * Records the attempt only. The row stays PENDING until Meta's `delivered`
   * webhook arrives — `sent_at` means "we handed it to Meta", and only
   * `delivered_at` consumes the partner's free quota.
   */
  private async recordSend(
    deliveryId: string,
    sent: { sent: boolean; providerMessageId?: string | null; error?: string }
  ): Promise<void> {
    await prisma.partner_lead_deliveries
      .update({
        where: { id: deliveryId },
        data: {
          sent_at: sent.sent ? new Date() : null,
          wa_message_id: sent.providerMessageId ?? null,
          updated_at: new Date(),
        },
      })
      .catch(() => undefined);
  }
}

export const partnerLeadDeliveryService = new PartnerLeadDeliveryService();
