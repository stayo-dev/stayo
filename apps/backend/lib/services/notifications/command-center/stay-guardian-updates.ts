import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { whatsAppTemplateDeliveryService } from "../whatsapp-template-delivery";
import { isGuardianVerified } from "./guardian-access";
import { decideStayGuardianNotice, type StayGuardianReason } from "./stay-guardian-policy";
import { consentStateOf } from "@/src/services/stay/stay-guardian-consent-state";
import { safeNormalize } from "@/src/services/stay/stay-guardian-consent";
import {
  STAY_GUARDIAN_TEMPLATES,
  buildStayDeparturePayload,
  buildStayReturnPayload,
} from "../providers/whatsapp/stay-guardian-template-contracts";

const logger = getLogger("whatsapp.command-center.stay-guardian");

/**
 * "Your ward has left" / "your ward is back" — the two messages of ADR-234.
 *
 * Called twice for the same event by design: once inline when the stay event
 * commits, and again by `/api/cron/stay-guardian-sweep` if that inline send
 * was lost. Both are deduped on `whatsapp_logs.idempotency_key`, keyed by the
 * *event* id, so whichever arrives first sends and the other skips.
 *
 * NEVER THROWS. A stay event is the tenant's own record of where they are; it
 * must not fail, or roll back, because WhatsApp did.
 */

export type StayGuardianSendResult = {
  sent: boolean;
  reason: StayGuardianReason | "SEND_FAILED" | "ALREADY_SENT" | "TENANT_NOT_FOUND";
};

export type StayGuardianSendInput = {
  /** `stay_events.id` — the idempotency key, and why a replay cannot double-send. */
  eventId: string;
  tenantId: string;
  eventType: string;
  leaveType: string | null;
  expectedReturnDate: string | null;
  occurredAt: string;
};

export async function sendStayGuardianUpdate(
  input: StayGuardianSendInput,
): Promise<StayGuardianSendResult> {
  // Cheapest check first: most stay events are not in this family at all, and
  // this runs on the write path.
  if (input.eventType !== "LEAVE_STARTED" && input.eventType !== "RETURNED") {
    return { sent: false, reason: "NOT_NOTIFIABLE" };
  }

  try {
    const tenant = await (prisma as any).tenants.findUnique({
      where: { id: input.tenantId },
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
    if (!tenant) return { sent: false, reason: "TENANT_NOT_FOUND" };

    const guardianPhone = (tenant.guardian_phone || tenant.phone_2 || "").trim();
    const residentPhone = (tenant.phone_1 || tenant.profiles?.phone || "").trim();

    const consentRow = await (prisma as any).stay_guardian_consent.findUnique({
      where: { tenant_id: input.tenantId },
      select: { granted: true, guardian_phone: true, revoked_at: true, stopped_at: true },
    });

    const consentState = consentStateOf(
      consentRow
        ? {
            granted: consentRow.granted,
            guardianPhone: consentRow.guardian_phone,
            revokedAt: consentRow.revoked_at,
            stoppedAt: consentRow.stopped_at,
          }
        : null,
      guardianPhone,
      safeNormalize,
    );

    // Run the policy once assuming verification, so the free refusals answer
    // first: `isGuardianVerified` is a database round trip and there is no
    // point paying for it to learn the tenant never consented.
    const cheap = decideStayGuardianNotice({
      eventType: input.eventType,
      consentState,
      guardianPhone,
      residentPhone,
      guardianVerified: true,
      normalise: safeNormalize,
    });
    if (!cheap.notify) {
      logger.info("stay_guardian.skipped", {
        tenant_id: input.tenantId,
        event_id: input.eventId,
        reason: cheap.reason,
      });
      return { sent: false, reason: cheap.reason };
    }

    const decision = decideStayGuardianNotice({
      eventType: input.eventType,
      consentState,
      guardianPhone,
      residentPhone,
      guardianVerified: await isGuardianVerified(guardianPhone),
      normalise: safeNormalize,
    });
    if (!decision.notify) {
      logger.info("stay_guardian.skipped", {
        tenant_id: input.tenantId,
        event_id: input.eventId,
        reason: decision.reason,
      });
      return { sent: false, reason: decision.reason };
    }

    const kind = decision.reason === "LEAVE" ? "DEPARTURE" : "RETURN";
    const template = STAY_GUARDIAN_TEMPLATES[kind];
    const bodyParameters =
      kind === "DEPARTURE"
        ? buildStayDeparturePayload({
            guardianName: tenant.guardian_name,
            tenantName: tenant.profiles?.name,
            hostelName: tenant.hostels?.name,
            leaveType: input.leaveType,
            returnDate: input.expectedReturnDate || "",
          })
        : buildStayReturnPayload({
            guardianName: tenant.guardian_name,
            tenantName: tenant.profiles?.name,
            hostelName: tenant.hostels?.name,
            checkInAt: input.occurredAt,
          });

    const result = await whatsAppTemplateDeliveryService.send({
      phone: guardianPhone,
      templateName: template.name,
      languageCode: template.language,
      bodyParameters,
      idempotencyKey: `stay_guardian:${input.eventId}`,
      tenantId: tenant.id,
      hostelId: tenant.hostel_id || undefined,
      ownerId: tenant.owner_id || undefined,
    });

    if (result.skipped) {
      // The other path got there first. Not an error.
      return { sent: false, reason: "ALREADY_SENT" };
    }

    logger.info("stay_guardian.sent", {
      tenant_id: tenant.id,
      event_id: input.eventId,
      template: template.name,
      provider_message_id: result.providerMessageId || null,
    });
    return { sent: true, reason: decision.reason };
  } catch (error: any) {
    // The sweep will try again. Losing the message is bad; unwinding the
    // tenant's own record of where they are would be worse.
    logger.error("stay_guardian.failed", {
      tenant_id: input.tenantId,
      event_id: input.eventId,
      error: error?.message || String(error),
    });
    return { sent: false, reason: "SEND_FAILED" };
  }
}
