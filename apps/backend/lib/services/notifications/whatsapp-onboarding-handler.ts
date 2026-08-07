import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { eventLog } from "@/lib/services/event-log-service";
import { normalizeWhatsAppPhone } from "./providers/whatsapp/meta-provider";
import {
  buildTenantOnboardingTemplatePayload,
  ONBOARDING_COMPLETED_TEMPLATE_NAME,
  onboardingTemplateLanguage,
} from "./providers/whatsapp/templates";
import { whatsAppTemplateDeliveryService } from "./whatsapp-template-delivery";

const logger = getLogger("whatsapp.onboarding");

/**
 * Handles the tenant onboarding activation/completed events.
 *
 * Architecture:
 *   Load tenant context from DB
 *     ↓
 *   Send tenant_onboarding_completed_v1 (idempotency key: tenant_onboarding_completed:{tenantId})
 *
 * There used to be a second branch here: a tenant who had not yet cleared their
 * deposit got `account_activated_payment_pending_v1` instead, because they had no
 * room yet. Rooms are no longer gated on payment, so every activated tenant has
 * one and there is nothing to route between.
 *
 * Rule 5: WhatsApp failure must never break onboarding.
 * Rule 6: All data loaded from database, never from request.
 */
export async function sendTenantOnboardingNotification(tenantId: string): Promise<void> {
  // 1. Load tenant context from database
  const tenant = await prisma.tenants.findUnique({
    where: { id: tenantId },
    include: {
      profiles: { select: { name: true } },
      hostels: { select: { id: true, name: true, auto_rent_day: true, owner_id: true } },
      room_allocations: {
        where: { is_active: true, end_date: null },
        orderBy: { start_date: "desc" as const },
        take: 1,
        include: { room: { select: { room_no: true } } },
      },
    },
  });

  if (!tenant) {
    logger.warn("whatsapp.onboarding.tenant_not_found", { tenant_id: tenantId });
    return;
  }

  if (tenant.status !== "ACTIVE") {
    logger.warn("whatsapp.onboarding.tenant_not_active", {
      tenant_id: tenantId,
      status: tenant.status,
    });
    return;
  }

  // 2. Resolve phone number
  const rawPhone = tenant.phone_1 || tenant.profiles?.phone;
  if (!rawPhone) {
    logger.warn("whatsapp.onboarding.no_phone", { tenant_id: tenantId });
    await eventLog.log("tenant_onboarding_whatsapp_failed", tenant.owner_id, {
      tenant_id: tenantId,
      hostel_id: tenant.hostel_id,
      reason: "no_phone_number",
    }, tenantId);
    return;
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeWhatsAppPhone(rawPhone);
  } catch {
    logger.warn("whatsapp.onboarding.invalid_phone", { tenant_id: tenantId });
    await eventLog.log("tenant_onboarding_whatsapp_failed", tenant.owner_id, {
      tenant_id: tenantId,
      hostel_id: tenant.hostel_id,
      reason: "invalid_phone_number",
    }, tenantId);
    return;
  }

  const hostel = tenant.hostels;
  if (!hostel) {
    logger.warn("whatsapp.onboarding.no_hostel", { tenant_id: tenantId });
    return;
  }

  // Joining is unconditional now — a tenant has their room from activation, so
  // there is one outcome to announce rather than a payment-pending branch.
  const allocation = tenant.room_allocations?.[0];
  const room = allocation?.room;

  // Build template payload (pure mapper)
  const bodyParameters = buildTenantOnboardingTemplatePayload({
    tenantName: tenant.profiles?.name || "Resident",
    hostelName: hostel.name,
    roomNumber: room?.room_no || "N/A",
    joiningDate: tenant.joined_on || new Date(),
    monthlyRent: Number(tenant.monthly_rent || 0),
    rentDueDay: hostel.auto_rent_day || 1,
  });

  const idempotencyKey = `tenant_onboarding_completed:${tenantId}`;

  try {
    const result = await whatsAppTemplateDeliveryService.send({
      phone: normalizedPhone,
      templateName: ONBOARDING_COMPLETED_TEMPLATE_NAME,
      bodyParameters,
      idempotencyKey,
      tenantId,
      hostelId: hostel.id,
      ownerId: tenant.owner_id || undefined,
      // The approved template is published as `en`; `en_IN` is a different
      // template to Meta and fails with #132001.
      languageCode: onboardingTemplateLanguage(),
    });

    if (result.skipped) {
      logger.info("whatsapp.onboarding.skipped", {
        tenant_id: tenantId,
        reason: "duplicate_or_invalid_phone",
      });
      return;
    }

    // Audit log — success
    await eventLog.log("tenant_onboarding_whatsapp_sent", tenant.owner_id, {
      tenant_id: tenantId,
      hostel_id: hostel.id,
      provider_message_id: result.providerMessageId,
      log_id: result.logId,
    }, tenantId);
  } catch (error: any) {
    // Audit log — failure (Rule 5: never break onboarding)
    logger.error("whatsapp.onboarding.send_failed", {
      tenant_id: tenantId,
      error: String(error?.message || error),
    });

    await eventLog.log("tenant_onboarding_whatsapp_failed", tenant.owner_id, {
      tenant_id: tenantId,
      hostel_id: hostel.id,
      error: String(error?.message || error).slice(0, 500),
    }, tenantId).catch(() => {});
  }
}
