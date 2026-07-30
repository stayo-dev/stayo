import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { getFrontendUrl } from "@/lib/config/domains";
import {
  MetaWhatsAppProvider,
  WhatsAppProviderError,
  WhatsAppValidationError,
  buildRentReminderBodyParameters,
  getMetaTemplateName,
  getMetaTemplateLanguage,
  maskWhatsAppPhone,
  normalizeWhatsAppPhone,
  selectRentReminderTemplate,
  WhatsAppRentReminderTemplate,
} from "./providers/whatsapp";

const logger = getLogger("whatsapp.reminder-delivery");

export type WhatsAppRentReminderInput = {
  ownerId: string;
  tenantId: string;
  hostelId: string;
  obligationId: string;
  phone: string;
  tenantName: string;
  hostelName: string;
  amount: number;
  rentMonth: Date | string;
  dueDate: Date | string;
  daysOverdue: number;
  sendDateKey: string;
  prefs?: any;
};

type ReservationResult = {
  id: string;
  delivery_status: string;
};

export class WhatsAppReminderDeliveryService {
  constructor(private readonly provider = new MetaWhatsAppProvider()) {}

  async sendRentReminder(input: WhatsAppRentReminderInput) {
    // 1. Check obligation status (PAID/SETTLED/CANCELLED) before execution to satisfy settlement stop rules
    const obligation = await prisma.rent_obligations.findUnique({
      where: { id: input.obligationId },
      select: { status: true, is_superseded: true },
    });

    if (
      !obligation ||
      obligation.status === "PAID" ||
      (obligation.status as string) === "SETTLED" ||
      (obligation.status as string) === "CANCELLED" ||
      (obligation.status as string) === "WAIVED" ||
      obligation.is_superseded
    ) {
      logger.info("whatsapp.reminder.stopped_settled", {
        obligation_id: input.obligationId,
        status: obligation?.status || "NOT_FOUND",
        is_superseded: obligation?.is_superseded,
      });
      return { sent: false, skipped: true, reason: "SETTLED_OR_CANCELLED" };
    }

    const template = selectRentReminderTemplate(input.daysOverdue);
    const templateName = getMetaTemplateName(template);
    const baseIdempotencyKey = `rent_reminder:${input.obligationId}:${template}:${input.sendDateKey}`;

    // Query tenant to get guardian phone details
    const tenant = await prisma.tenants.findUnique({
      where: { id: input.tenantId },
      select: { guardian_phone: true },
    });

    // Send to tenant (Primary recipient)
    let tenantResult;
    try {
      tenantResult = await this.sendReminderToRecipient(
        input,
        input.phone,
        `${baseIdempotencyKey}:tenant`,
        template,
        templateName
      );
    } catch (tenantErr) {
      logger.error("whatsapp.reminder.tenant_failed", {
        obligation_id: input.obligationId,
        phone: maskWhatsAppPhone(input.phone),
        error: String(tenantErr),
      });
      throw tenantErr;
    }

    // Escalation rule: Overdue (starting 3 days overdue) goes to Tenant + Guardian
    const isOverdueEscalation = input.daysOverdue >= 3;
    if (isOverdueEscalation && tenant?.guardian_phone) {
      try {
        await this.sendReminderToRecipient(
          input,
          tenant.guardian_phone,
          `${baseIdempotencyKey}:guardian`,
          template,
          templateName
        );
      } catch (guardianErr) {
        logger.error("whatsapp.reminder.guardian_failed", {
          obligation_id: input.obligationId,
          phone: maskWhatsAppPhone(tenant.guardian_phone),
          error: String(guardianErr),
        });
        // We log the guardian failure, but we do not block the method since tenant reminder succeeded
      }
    }

    return tenantResult;
  }

  private async sendReminderToRecipient(
    input: WhatsAppRentReminderInput,
    phone: string,
    idempotencyKey: string,
    template: WhatsAppRentReminderTemplate,
    templateName: string
  ) {
    let normalizedPhone = phone;
    let maskedPhone = maskWhatsAppPhone(phone);

    const reserved = await this.reserveDelivery({
      ...input,
      phone,
      templateName,
      idempotencyKey,
    });

    if (!reserved) {
      logger.info("whatsapp.reminder.duplicate_skipped", {
        owner_id: input.ownerId,
        tenant_id: input.tenantId,
        obligation_id: input.obligationId,
        template,
        phone: maskedPhone,
      });
      return { sent: false, skipped: true, idempotencyKey };
    }

    try {
      normalizedPhone = normalizeWhatsAppPhone(phone);
      maskedPhone = maskWhatsAppPhone(normalizedPhone);
      const bodyParameters = buildRentReminderBodyParameters(input);

      // Create a payment link token (7-day expiry) for this obligation
      let paymentUrl: string | null = null;
      let tokenValue: string | null = null;
      try {
        const token = await prisma.payment_link_tokens.create({
          data: {
            obligation_id: input.obligationId,
            tenant_id: input.tenantId,
            hostel_id: input.hostelId,
            owner_id: input.ownerId,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          },
          select: { token: true },
        });

        tokenValue = token.token;
        const appUrl = getFrontendUrl().replace(/\/+$/, "");
        paymentUrl = `${appUrl}/pay/${token.token}`;
      } catch (tokenErr) {
        logger.warn("whatsapp.reminder.payment_link_failed", {
          obligation_id: input.obligationId,
          error: String((tokenErr as any)?.message || tokenErr),
        });
      }

      // Attach the payment URL token to the approved Meta template button via buttonParameters
      const result = await this.provider.sendTemplate({
        to: normalizedPhone,
        templateName,
        language: { code: getMetaTemplateLanguage(template) },
        bodyParameters: bodyParameters,
        buttonParameters: tokenValue ? [tokenValue] : undefined,
      });

      await prisma.$executeRaw`
        UPDATE whatsapp_logs
        SET status = 'SENT',
            delivery_status = 'SENT',
            provider_message_id = ${result.providerMessageId},
            provider_response = ${JSON.stringify(result.raw)}::jsonb,
            attempt_count = ${result.attempts},
            provider_error_code = NULL,
            provider_error_message = NULL
        WHERE id = ${reserved.id}::uuid
      `;

      logger.info("whatsapp.reminder.sent", {
        owner_id: input.ownerId,
        tenant_id: input.tenantId,
        obligation_id: input.obligationId,
        template,
        phone: maskedPhone,
        attempts: result.attempts,
      });

      return {
        sent: true,
        skipped: false,
        logId: reserved.id,
        providerMessageId: result.providerMessageId,
        idempotencyKey,
      };
    } catch (error: any) {
      await this.markFailed(reserved.id, error);
      logger.warn("whatsapp.reminder.failed", {
        owner_id: input.ownerId,
        tenant_id: input.tenantId,
        obligation_id: input.obligationId,
        template,
        phone: maskedPhone,
        retryable: error instanceof WhatsAppProviderError ? error.retryable : false,
        error_code: error?.providerCode || error?.code || "WHATSAPP_SEND_FAILED",
        error: String(error?.message || error),
      });
      throw error;
    }
  }

  private async reserveDelivery(
    input: WhatsAppRentReminderInput & {
      phone: string;
      templateName: string;
      idempotencyKey: string;
    }
  ): Promise<ReservationResult | null> {
    const rows = await prisma.$queryRaw<ReservationResult[]>`
      INSERT INTO whatsapp_logs (
        id,
        phone,
        template,
        template_name,
        obligation_id,
        owner_id,
        tenant_id,
        hostel_id,
        status,
        delivery_status,
        idempotency_key,
        attempt_count
      )
      VALUES (
        gen_random_uuid(),
        ${input.phone},
        ${input.templateName},
        ${input.templateName},
        ${input.obligationId}::uuid,
        ${input.ownerId}::uuid,
        ${input.tenantId}::uuid,
        ${input.hostelId}::uuid,
        'PENDING',
        'PENDING',
        ${input.idempotencyKey},
        0
      )
      ON CONFLICT (idempotency_key) DO UPDATE
      SET phone = EXCLUDED.phone,
          template = EXCLUDED.template,
          template_name = EXCLUDED.template_name,
          owner_id = EXCLUDED.owner_id,
          tenant_id = EXCLUDED.tenant_id,
          hostel_id = EXCLUDED.hostel_id,
          obligation_id = EXCLUDED.obligation_id,
          status = 'PENDING',
          delivery_status = 'PENDING',
          provider_message_id = NULL,
          provider_error_code = NULL,
          provider_error_message = NULL,
          error_message = NULL,
          attempt_count = 0,
          provider_response = NULL
      WHERE whatsapp_logs.status = 'FAILED'
         OR whatsapp_logs.delivery_status IN ('FAILED_FINAL', 'FAILED_RETRYABLE')
      RETURNING id::text, delivery_status
    `;

    return rows[0] || null;
  }

  private async markFailed(logId: string, error: unknown) {
    const normalized = normalizeDeliveryError(error);
    await prisma.$executeRaw`
      UPDATE whatsapp_logs
      SET status = 'FAILED',
          delivery_status = ${normalized.deliveryStatus},
          provider_error_code = ${normalized.code},
          provider_error_message = ${normalized.message},
          attempt_count = ${normalized.attempts},
          provider_response = ${normalized.raw ? JSON.stringify(normalized.raw) : null}::jsonb
      WHERE id = ${logId}::uuid
    `;
  }
}

function normalizeDeliveryError(error: unknown) {
  if (error instanceof WhatsAppProviderError) {
    return {
      deliveryStatus: error.retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL",
      code: error.providerCode || error.code,
      message: error.message.slice(0, 500),
      attempts: error.attempts,
      raw: error.raw || null,
    };
  }

  if (error instanceof WhatsAppValidationError) {
    return {
      deliveryStatus: "FAILED_FINAL",
      code: error.code,
      message: error.message.slice(0, 500),
      attempts: 0,
      raw: null,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    deliveryStatus: "FAILED_FINAL",
    code: "WHATSAPP_SEND_FAILED",
    message: message.slice(0, 500),
    attempts: 0,
    raw: null,
  };
}

export const whatsappReminderDeliveryService = new WhatsAppReminderDeliveryService();
