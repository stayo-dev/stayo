import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { eventLog } from "@/lib/services/event-log-service";
import { normalizeWhatsAppPhone } from "./providers/whatsapp/meta-provider";
import {
  buildOwnerWelcomeTemplatePayload,
  OWNER_WELCOME_TEMPLATE_NAME,
  ownerWelcomeTemplateLanguage,
} from "./providers/whatsapp/templates";
import { whatsAppTemplateDeliveryService } from "./whatsapp-template-delivery";

const logger = getLogger("whatsapp.owner-welcome");

/**
 * Sends the one-time "you're all set" WhatsApp message once an owner who
 * came through the platform-leads approval funnel finishes real signup.
 *
 * This is distinct from sendOwnerActivation (the approval-time invite that
 * carries the unique activation link) — stayo_owner_welcome's own wording
 * ("your account has been created successfully") and its static dashboard
 * button only make sense *after* activation, so it's fired from
 * app/api/auth/owner-signup/route.ts's lead-activation branch, not from
 * lead-invitation-service.ts's approveLead().
 *
 * Never blocks signup — same "Rule 5" as whatsapp-onboarding-handler.ts.
 */
export async function sendOwnerWelcomeNotification(profileId: string): Promise<void> {
  const owner = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { id: true, name: true, phone: true },
  });

  if (!owner) {
    logger.warn("whatsapp.owner_welcome.profile_not_found", { profile_id: profileId });
    return;
  }

  if (!owner.phone) {
    logger.warn("whatsapp.owner_welcome.no_phone", { profile_id: profileId });
    await eventLog.log("owner_welcome_whatsapp_failed", profileId, { reason: "no_phone_number" });
    return;
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeWhatsAppPhone(owner.phone);
  } catch {
    logger.warn("whatsapp.owner_welcome.invalid_phone", { profile_id: profileId });
    await eventLog.log("owner_welcome_whatsapp_failed", profileId, { reason: "invalid_phone_number" });
    return;
  }

  const bodyParameters = buildOwnerWelcomeTemplatePayload({ ownerName: owner.name });
  const idempotencyKey = `owner_welcome:${profileId}`;

  try {
    const result = await whatsAppTemplateDeliveryService.send({
      phone: normalizedPhone,
      templateName: OWNER_WELCOME_TEMPLATE_NAME,
      bodyParameters,
      idempotencyKey,
      ownerId: profileId,
      languageCode: ownerWelcomeTemplateLanguage(),
    });

    if (result.skipped) {
      logger.info("whatsapp.owner_welcome.skipped", { profile_id: profileId, reason: "duplicate_or_invalid_phone" });
      return;
    }

    await eventLog.log("owner_welcome_whatsapp_sent", profileId, {
      provider_message_id: result.providerMessageId,
      log_id: result.logId,
    });
  } catch (error: any) {
    logger.error("whatsapp.owner_welcome.send_failed", {
      profile_id: profileId,
      error: String(error?.message || error),
    });
    await eventLog.log("owner_welcome_whatsapp_failed", profileId, {
      reason: "send_failed",
      error: String(error?.message || error).slice(0, 500),
    }).catch(() => {});
  }
}
