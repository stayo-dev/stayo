/**
 * "Guardian Access Activated" — the channel's first word to a guardian.
 *
 * Sent when a tenant enters their guardian's number during onboarding and
 * verifies it. Until now that verification produced a row in
 * `phone_verification_otps` and nothing else: the guardian had proved they
 * hold the handset and was never told what that handset could now do. The
 * first message they ever received was a rent reminder, weeks later.
 *
 * Never throws. Onboarding must not fail because a template send did — same
 * non-blocking rule the platform-lead sends follow.
 */

import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { whatsAppTemplateDeliveryService } from "../whatsapp-template-delivery";
import {
  buildGuardianActivationPayload,
  guardianActivationTemplateLanguage,
  guardianActivationTemplateName,
} from "../providers/whatsapp/guardian-activation-template-contract";
import { normalizeWhatsAppPhone } from "../providers/whatsapp";

const logger = getLogger("whatsapp.command-center.guardian-activation");

export type GuardianActivationResult = {
  sent: boolean;
  skipped: boolean;
  reason?:
    | "TENANT_NOT_FOUND"
    | "NO_GUARDIAN_PHONE"
    | "GUARDIAN_SAME_AS_RESIDENT"
    | "ALREADY_SENT"
    | "SEND_FAILED";
};

/**
 * Announce guardian access for one tenant.
 *
 * Idempotent on `(tenant, guardian number)` via `whatsapp_logs.idempotency_key`,
 * so re-running onboarding, or a tenant re-saving the same guardian, sends
 * once. Changing the guardian's number *does* produce a new key — the new
 * person has not been told anything yet, and should be.
 */
export async function sendGuardianActivation(tenantId: string): Promise<GuardianActivationResult> {
  try {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        owner_id: true,
        hostel_id: true,
        phone_1: true,
        phone_2: true,
        guardian_name: true,
        guardian_phone: true,
        profiles: { select: { name: true, phone: true } },
        hostels: { select: { name: true } },
      },
    });

    if (!tenant) return { sent: false, skipped: true, reason: "TENANT_NOT_FOUND" };

    // `phone_2` and `guardian_phone` are kept in step by `tenant-service`, but
    // read both — activation writes `phone_2` first on some paths.
    const guardianPhone = (tenant.guardian_phone || tenant.phone_2 || "").trim();
    if (!guardianPhone) return { sent: false, skipped: true, reason: "NO_GUARDIAN_PHONE" };

    const residentPhone = (tenant.phone_1 || tenant.profiles?.phone || "").trim();
    if (residentPhone && safeNormalize(guardianPhone) === safeNormalize(residentPhone)) {
      // One handset in both fields. The resident already knows; telling them
      // they are their own guardian is noise at best.
      return { sent: false, skipped: true, reason: "GUARDIAN_SAME_AS_RESIDENT" };
    }

    const bodyParameters = buildGuardianActivationPayload({
      guardianName: tenant.guardian_name,
      // {{2}} is the *tenant's* name — the body supplies "the guardian for …"
      // and "on behalf of your ward" around it, so a possessive here would read
      // "the guardian for Aarav's". `tenantDisplayName` strips one if present.
      tenantName: tenant.profiles?.name,
      hostelName: tenant.hostels?.name,
    });

    const result = await whatsAppTemplateDeliveryService.send({
      phone: guardianPhone,
      templateName: guardianActivationTemplateName(),
      languageCode: guardianActivationTemplateLanguage(),
      bodyParameters,
      idempotencyKey: `guardian_activation:${tenant.id}:${safeNormalize(guardianPhone)}`,
      tenantId: tenant.id,
      hostelId: tenant.hostel_id,
      ownerId: tenant.owner_id || undefined,
    });

    if (result.skipped) {
      logger.info("guardian_activation.skipped", { tenant_id: tenant.id });
      return { sent: false, skipped: true, reason: "ALREADY_SENT" };
    }

    logger.info("guardian_activation.sent", {
      tenant_id: tenant.id,
      template: guardianActivationTemplateName(),
      provider_message_id: result.providerMessageId || null,
    });

    return { sent: true, skipped: false };
  } catch (error: any) {
    // Onboarding does not fail because WhatsApp did.
    logger.error("guardian_activation.failed", {
      tenant_id: tenantId,
      error: error?.message || String(error),
    });
    return { sent: false, skipped: true, reason: "SEND_FAILED" };
  }
}

function safeNormalize(phone: string): string {
  try {
    return normalizeWhatsAppPhone(phone);
  } catch {
    return String(phone || "").replace(/\D/g, "");
  }
}
