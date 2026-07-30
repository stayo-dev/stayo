import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { eventLog } from "@/lib/services/event-log-service";
import { normalizeWhatsAppPhone } from "./providers/whatsapp/meta-provider";
import {
  buildRenewalOfferSentPayload,
  buildRenewalOfferDeclinedPayload,
  buildRenewalOfferDiscussionPayload,
  RENEWAL_OFFER_SENT_TEMPLATE_NAME,
  RENEWAL_OFFER_DECLINED_TEMPLATE_NAME,
  RENEWAL_OFFER_DISCUSSION_TEMPLATE_NAME,
} from "./providers/whatsapp/templates";
import { whatsAppTemplateDeliveryService } from "./whatsapp-template-delivery";

const logger = getLogger("whatsapp.renewal-handler");

export async function sendRenewalOfferNotification(offerId: string): Promise<void> {
  const offer = await prisma.renewalOffer.findUnique({
    where: { id: offerId },
    include: {
      tenant: {
        include: {
          profiles: { select: { name: true } },
        },
      },
      hostel: {
        include: {
          profiles: { select: { phone: true, name: true } },
        },
      },
    },
  });

  if (!offer) {
    logger.warn("whatsapp.renewal.offer_not_found", { offer_id: offerId });
    return;
  }

  const tenant = offer.tenant;
  const hostel = offer.hostel;
  const tenantName = tenant.profiles?.name || "Resident";
  const hostelName = hostel.name || "Your Hostel";

  const sendToPhone = async (phone: string, targetName: string, isGuardian: boolean) => {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeWhatsAppPhone(phone);
    } catch {
      logger.warn("whatsapp.renewal.invalid_phone", { offer_id: offerId, phone, targetName });
      await eventLog.log("renewal_offer_whatsapp_failed", offer.owner_id, {
        offer_id: offerId,
        tenant_id: offer.tenant_id,
        hostel_id: offer.hostel_id,
        reason: `invalid_phone_number_for_${isGuardian ? "guardian" : "tenant"}`,
        phone,
      }, offer.tenant_id).catch(() => {});
      return;
    }

    const payload = buildRenewalOfferSentPayload({
      tenantName: targetName,
      hostelName,
      proposedRent: Number(offer.proposed_rent),
      expiryDate: offer.offer_expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const idempotencyKey = `renewal_offer_sent_${isGuardian ? "guardian" : "tenant"}:${offerId}`;

    try {
      const result = await whatsAppTemplateDeliveryService.send({
        phone: normalizedPhone,
        templateName: RENEWAL_OFFER_SENT_TEMPLATE_NAME,
        bodyParameters: payload,
        idempotencyKey,
        tenantId: offer.tenant_id,
        hostelId: offer.hostel_id,
        ownerId: offer.owner_id,
        languageCode: "en_IN",
      });

      if (result.skipped) {
        logger.info("whatsapp.renewal.sent.skipped", { offer_id: offerId, phone });
        return;
      }

      await eventLog.log(`renewal_offer_whatsapp_sent_${isGuardian ? "guardian" : "tenant"}`, offer.owner_id, {
        offer_id: offerId,
        tenant_id: offer.tenant_id,
        hostel_id: offer.hostel_id,
        provider_message_id: result.providerMessageId,
        log_id: result.logId,
      }, offer.tenant_id).catch(() => {});
    } catch (error: any) {
      logger.error("whatsapp.renewal.sent.failed", { offer_id: offerId, phone, error: error.message });
      await eventLog.log(`renewal_offer_whatsapp_failed_${isGuardian ? "guardian" : "tenant"}`, offer.owner_id, {
        offer_id: offerId,
        tenant_id: offer.tenant_id,
        hostel_id: offer.hostel_id,
        error: String(error?.message || error).slice(0, 500),
      }, offer.tenant_id).catch(() => {});
    }
  };

  const target = offer.notification_target;

  if (target === "TENANT" || target === "BOTH") {
    const tenantPhone = tenant.phone_1 || tenant.profiles?.phone;
    if (tenantPhone) {
      await sendToPhone(tenantPhone, tenantName, false);
    } else {
      logger.warn("whatsapp.renewal.no_tenant_phone", { offer_id: offerId });
    }
  }

  if (target === "GUARDIAN" || target === "BOTH") {
    const guardianPhone = tenant.guardian_phone;
    const guardianName = tenant.guardian_name || `Guardian of ${tenantName}`;
    if (guardianPhone) {
      await sendToPhone(guardianPhone, guardianName, true);
    } else {
      logger.warn("whatsapp.renewal.no_guardian_phone", { offer_id: offerId });
      await eventLog.log("renewal_offer_whatsapp_failed", offer.owner_id, {
        offer_id: offerId,
        tenant_id: offer.tenant_id,
        hostel_id: offer.hostel_id,
        reason: "no_guardian_phone_number",
      }, offer.tenant_id).catch(() => {});
    }
  }
}

export async function sendRenewalOfferDeclinedNotification(offerId: string, reason?: string): Promise<void> {
  const offer = await prisma.renewalOffer.findUnique({
    where: { id: offerId },
    include: {
      tenant: {
        include: {
          profiles: { select: { name: true } },
          room_allocations: {
            where: { is_active: true, end_date: null },
            take: 1,
            include: { room: { select: { room_no: true } } },
          },
        },
      },
      hostel: {
        include: {
          profiles: { select: { phone: true, name: true } },
        },
      },
    },
  });

  if (!offer) {
    logger.warn("whatsapp.renewal.decline_offer_not_found", { offer_id: offerId });
    return;
  }

  const ownerPhone = offer.hostel.profiles?.phone || offer.hostel.phone;
  if (!ownerPhone) {
    logger.warn("whatsapp.renewal.decline_no_owner_phone", { offer_id: offerId });
    return;
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeWhatsAppPhone(ownerPhone);
  } catch {
    logger.warn("whatsapp.renewal.decline_invalid_owner_phone", { offer_id: offerId, phone: ownerPhone });
    await eventLog.log("renewal_offer_declined_whatsapp_failed", offer.owner_id, {
      offer_id: offerId,
      tenant_id: offer.tenant_id,
      hostel_id: offer.hostel_id,
      reason: "invalid_owner_phone_number",
      phone: ownerPhone,
    }, offer.tenant_id).catch(() => {});
    return;
  }

  const tenantName = offer.tenant.profiles?.name || "Resident";
  const roomNo = offer.tenant.room_allocations?.[0]?.room?.room_no || "N/A";
  const declineReason = reason || offer.decline_reason || "No reason provided";

  const payload = buildRenewalOfferDeclinedPayload({
    tenantName,
    roomNo,
    reason: declineReason,
  });

  const idempotencyKey = `renewal_offer_declined:${offerId}`;

  try {
    const result = await whatsAppTemplateDeliveryService.send({
      phone: normalizedPhone,
      templateName: RENEWAL_OFFER_DECLINED_TEMPLATE_NAME,
      bodyParameters: payload,
      idempotencyKey,
      tenantId: offer.tenant_id,
      hostelId: offer.hostel_id,
      ownerId: offer.owner_id,
      languageCode: "en_IN",
    });

    if (result.skipped) {
      logger.info("whatsapp.renewal.decline.skipped", { offer_id: offerId });
      return;
    }

    await eventLog.log("renewal_offer_declined_whatsapp_sent", offer.owner_id, {
      offer_id: offerId,
      tenant_id: offer.tenant_id,
      hostel_id: offer.hostel_id,
      provider_message_id: result.providerMessageId,
      log_id: result.logId,
    }, offer.tenant_id).catch(() => {});
  } catch (error: any) {
    logger.error("whatsapp.renewal.decline.failed", { offer_id: offerId, error: error.message });
    await eventLog.log("renewal_offer_declined_whatsapp_failed", offer.owner_id, {
      offer_id: offerId,
      tenant_id: offer.tenant_id,
      hostel_id: offer.hostel_id,
      error: String(error?.message || error).slice(0, 500),
    }, offer.tenant_id).catch(() => {});
  }
}

export async function sendRenewalOfferDiscussionNotification(offerId: string, message?: string): Promise<void> {
  const offer = await prisma.renewalOffer.findUnique({
    where: { id: offerId },
    include: {
      tenant: {
        include: {
          profiles: { select: { name: true } },
          room_allocations: {
            where: { is_active: true, end_date: null },
            take: 1,
            include: { room: { select: { room_no: true } } },
          },
        },
      },
      hostel: {
        include: {
          profiles: { select: { phone: true, name: true } },
        },
      },
    },
  });

  if (!offer) {
    logger.warn("whatsapp.renewal.discuss_offer_not_found", { offer_id: offerId });
    return;
  }

  const ownerPhone = offer.hostel.profiles?.phone || offer.hostel.phone;
  if (!ownerPhone) {
    logger.warn("whatsapp.renewal.discuss_no_owner_phone", { offer_id: offerId });
    return;
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeWhatsAppPhone(ownerPhone);
  } catch {
    logger.warn("whatsapp.renewal.discuss_invalid_owner_phone", { offer_id: offerId, phone: ownerPhone });
    await eventLog.log("renewal_offer_discussion_whatsapp_failed", offer.owner_id, {
      offer_id: offerId,
      tenant_id: offer.tenant_id,
      hostel_id: offer.hostel_id,
      reason: "invalid_owner_phone_number",
      phone: ownerPhone,
    }, offer.tenant_id).catch(() => {});
    return;
  }

  const tenantName = offer.tenant.profiles?.name || "Resident";
  const roomNo = offer.tenant.room_allocations?.[0]?.room?.room_no || "N/A";
  const discussMsg = message || "Wants to discuss renewal terms";

  const payload = buildRenewalOfferDiscussionPayload({
    tenantName,
    roomNo,
    message: discussMsg,
  });

  const idempotencyKey = `renewal_offer_discussion:${offerId}`;

  try {
    const result = await whatsAppTemplateDeliveryService.send({
      phone: normalizedPhone,
      templateName: RENEWAL_OFFER_DISCUSSION_TEMPLATE_NAME,
      bodyParameters: payload,
      idempotencyKey,
      tenantId: offer.tenant_id,
      hostelId: offer.hostel_id,
      ownerId: offer.owner_id,
      languageCode: "en_IN",
    });

    if (result.skipped) {
      logger.info("whatsapp.renewal.discuss.skipped", { offer_id: offerId });
      return;
    }

    await eventLog.log("renewal_offer_discussion_whatsapp_sent", offer.owner_id, {
      offer_id: offerId,
      tenant_id: offer.tenant_id,
      hostel_id: offer.hostel_id,
      provider_message_id: result.providerMessageId,
      log_id: result.logId,
    }, offer.tenant_id).catch(() => {});
  } catch (error: any) {
    logger.error("whatsapp.renewal.discuss.failed", { offer_id: offerId, error: error.message });
    await eventLog.log("renewal_offer_discussion_whatsapp_failed", offer.owner_id, {
      offer_id: offerId,
      tenant_id: offer.tenant_id,
      hostel_id: offer.hostel_id,
      error: String(error?.message || error).slice(0, 500),
    }, offer.tenant_id).catch(() => {});
  }
}
