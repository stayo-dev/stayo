import { getLogger } from "@/lib/logger";
import { eventLog } from "@/lib/services/event-log-service";
import { whatsAppTemplateDeliveryService } from "@/lib/services/notifications/whatsapp-template-delivery";
import {
  AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME,
  AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
  OWNER_RENEWAL_ALERT_TEMPLATE_NAME,
  buildAgreementRenewalReminderPayload,
  buildAgreementRenewalOverduePayload,
  buildOwnerRenewalAlertPayload,
} from "@/lib/services/notifications/providers/whatsapp/templates";
import { renewalStatusService, RenewalStage } from "./renewal-status-service";

const logger = getLogger("whatsapp.renewal-notifications");

export class AgreementRenewalNotificationService {
  async processRenewalNotifications(agreement: any, now: Date = new Date()): Promise<{
    tenantSent: boolean;
    ownerSent: boolean;
    skipped: boolean;
    error?: string;
  }> {
    const result = { tenantSent: false, ownerSent: false, skipped: true, error: undefined as string | undefined };

    try {
      const stage = renewalStatusService.determineRenewalStage(agreement, now);
      if (!stage) {
        return result;
      }

      result.skipped = false;

      const tenantProfile = agreement.tenant?.profiles;
      const tenantPhone = agreement.tenant?.phone_1 || tenantProfile?.phone;
      const tenantName = tenantProfile?.name || agreement.content_snapshot?.tenant_name || "Resident";
      
      const ownerProfile = agreement.hostel?.profiles;
      const ownerPhone = ownerProfile?.phone || agreement.hostel?.phone;
      const ownerId = agreement.hostel?.owner_id || agreement.tenant?.owner_id || null;

      const roomNo = agreement.tenant?.room_allocations?.[0]?.room?.room_no || "N/A";
      const expiryDate = agreement.agreement_end_date;

      const statusMap: Record<RenewalStage, string> = {
        "30_DAY_REMINDER": "Expiring in 30 days",
        "15_DAY_REMINDER": "Expiring in 15 days",
        "EXPIRY_DAY_ALERT": "Expires Today",
        "7_DAY_OVERDUE": "Overdue by 7 days",
        "30_DAY_CRITICAL": "Critical Overdue",
        "EXPIRED_RENT_OVERDUE": "Rent Overdue",
      };

      const statusText = statusMap[stage];

      // ─── 1. Send Tenant Notification ───
      if (tenantPhone) {
        let tenantTemplateName = AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME;
        let tenantPayload: string[] = [];

        if (
          stage === "30_DAY_REMINDER" ||
          stage === "15_DAY_REMINDER"
        ) {
          tenantTemplateName = AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME;
          tenantPayload = buildAgreementRenewalReminderPayload({
            tenantName,
            expiryDate,
            status: statusText,
          });
        } else {
          tenantTemplateName = AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME;
          tenantPayload = buildAgreementRenewalOverduePayload({
            tenantName,
            expiredOn: expiryDate,
            status: statusText,
          });
        }

        const tenantIdempotencyKey = `agreement_renewal_${stage.toLowerCase()}:${agreement.id}`;

        try {
          const tenantDelivery = await whatsAppTemplateDeliveryService.send({
            phone: tenantPhone,
            templateName: tenantTemplateName,
            bodyParameters: tenantPayload,
            idempotencyKey: tenantIdempotencyKey,
            tenantId: agreement.tenant_id,
            hostelId: agreement.hostel_id,
            ownerId: ownerId || undefined,
            languageCode: "en_IN",
          });

          if (tenantDelivery.sent) {
            result.tenantSent = true;
            await eventLog.log(
              "tenant_renewal_whatsapp_sent",
              ownerId,
              {
                agreement_id: agreement.id,
                tenant_id: agreement.tenant_id,
                stage,
                provider_message_id: tenantDelivery.providerMessageId,
              },
              agreement.tenant_id
            );
          }
        } catch (err: any) {
          logger.error("whatsapp.renewal.tenant_send_failed", {
            agreement_id: agreement.id,
            stage,
            error: err.message || String(err),
          });
          await eventLog.log(
            "tenant_renewal_whatsapp_failed",
            ownerId,
            {
              agreement_id: agreement.id,
              tenant_id: agreement.tenant_id,
              stage,
              error: (err.message || String(err)).slice(0, 500),
            },
            agreement.tenant_id
          ).catch(() => {});
        }
      } else {
        logger.warn("whatsapp.renewal.no_tenant_phone", { agreement_id: agreement.id });
      }

      // ─── 2. Send Owner Notification ───
      if (ownerPhone) {
        const ownerPayload = buildOwnerRenewalAlertPayload({
          tenantName,
          roomNo,
          status: statusText,
          expiryDate,
          tenantPhone: tenantPhone || "N/A",
        });

        const ownerIdempotencyKey = `owner_renewal_alert_${stage.toLowerCase()}:${agreement.id}`;

        try {
          const ownerDelivery = await whatsAppTemplateDeliveryService.send({
            phone: ownerPhone,
            templateName: OWNER_RENEWAL_ALERT_TEMPLATE_NAME,
            bodyParameters: ownerPayload,
            idempotencyKey: ownerIdempotencyKey,
            tenantId: agreement.tenant_id,
            hostelId: agreement.hostel_id,
            ownerId: ownerId || undefined,
            languageCode: "en_IN",
          });

          if (ownerDelivery.sent) {
            result.ownerSent = true;
            await eventLog.log(
              "owner_renewal_whatsapp_sent",
              ownerId,
              {
                agreement_id: agreement.id,
                tenant_id: agreement.tenant_id,
                stage,
                provider_message_id: ownerDelivery.providerMessageId,
              },
              agreement.tenant_id
            );
          }
        } catch (err: any) {
          logger.error("whatsapp.renewal.owner_send_failed", {
            agreement_id: agreement.id,
            stage,
            error: err.message || String(err),
          });
          await eventLog.log(
            "owner_renewal_whatsapp_failed",
            ownerId,
            {
              agreement_id: agreement.id,
              tenant_id: agreement.tenant_id,
              stage,
              error: (err.message || String(err)).slice(0, 500),
            },
            agreement.tenant_id
          ).catch(() => {});
        }
      } else {
        logger.warn("whatsapp.renewal.no_owner_phone", { agreement_id: agreement.id });
      }

    } catch (error: any) {
      result.error = error.message || String(error);
      logger.error("whatsapp.renewal.process_failed", {
        agreement_id: agreement.id,
        error: result.error,
      });
    }

    return result;
  }

  async checkTemplatesHealth(): Promise<{ name: string; exists: boolean; status?: string }[]> {
    const templates = [
      AGREEMENT_RENEWAL_REMINDER_TEMPLATE_NAME,
      AGREEMENT_RENEWAL_OVERDUE_TEMPLATE_NAME,
      OWNER_RENEWAL_ALERT_TEMPLATE_NAME,
    ];

    const results = [];
    for (const name of templates) {
      try {
        const health = await whatsAppTemplateDeliveryService.verifyTemplateHealth(name);
        results.push({ name, exists: health.exists, status: health.status });
      } catch (err: any) {
        logger.error("whatsapp.renewal.template_health_check_failed", {
          name,
          error: err.message || String(err),
        });
        results.push({ name, exists: false });
      }
    }
    return results;
  }
}

export const agreementRenewalNotificationService = new AgreementRenewalNotificationService();
