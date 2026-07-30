import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import {
  MetaWhatsAppProvider,
  WhatsAppProviderError,
  WhatsAppValidationError,
  normalizeWhatsAppPhone,
  maskWhatsAppPhone,
} from "./providers/whatsapp";

const logger = getLogger("whatsapp.template-delivery");

export type WhatsAppTemplateDeliveryInput = {
  phone: string;
  templateName: string;
  bodyParameters: string[];
  idempotencyKey: string;
  tenantId?: string;
  hostelId?: string;
  ownerId?: string;
  obligationId?: string;
  languageCode?: string;
};

export type WhatsAppTemplateDeliveryResult = {
  sent: boolean;
  skipped: boolean;
  logId?: string;
  providerMessageId?: string | null;
  idempotencyKey: string;
};

type ReservationRow = {
  id: string;
  delivery_status: string;
};

/**
 * Generic idempotent WhatsApp template delivery service.
 *
 * Reusable for any template: onboarding, reminders, receipts, move-out, etc.
 * Uses whatsapp_logs.idempotency_key for duplicate prevention.
 */
export class WhatsAppTemplateDeliveryService {
  constructor(private readonly provider = new MetaWhatsAppProvider()) {}

  async verifyTemplateHealth(templateName: string): Promise<{ exists: boolean; status?: string }> {
    return this.provider.getTemplateStatus(templateName);
  }

  async send(input: WhatsAppTemplateDeliveryInput): Promise<WhatsAppTemplateDeliveryResult> {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeWhatsAppPhone(input.phone);
    } catch {
      logger.warn("whatsapp.template.invalid_phone", {
        phone: maskWhatsAppPhone(input.phone),
        template: input.templateName,
        idempotency_key: input.idempotencyKey,
      });
      return { sent: false, skipped: true, idempotencyKey: input.idempotencyKey };
    }

    // 1. Reserve delivery slot (idempotent)
    const reserved = await this.reserveDelivery(input, normalizedPhone);
    if (!reserved) {
      logger.info("whatsapp.template.duplicate_skipped", {
        template: input.templateName,
        tenant_id: input.tenantId,
        idempotency_key: input.idempotencyKey,
      });
      return { sent: false, skipped: true, idempotencyKey: input.idempotencyKey };
    }

    // 2. Send via MetaWhatsAppProvider
    try {
      const result = await this.provider.sendTemplate({
        to: normalizedPhone,
        templateName: input.templateName,
        bodyParameters: input.bodyParameters,
        language: input.languageCode ? { code: input.languageCode } : undefined,
      });

      // 3. Mark success
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

      logger.info("whatsapp.template.sent", {
        template: input.templateName,
        tenant_id: input.tenantId,
        phone: maskWhatsAppPhone(normalizedPhone),
        attempts: result.attempts,
      });

      return {
        sent: true,
        skipped: false,
        logId: reserved.id,
        providerMessageId: result.providerMessageId,
        idempotencyKey: input.idempotencyKey,
      };
    } catch (error: any) {
      // 3. Mark failure
      await this.markFailed(reserved.id, error);

      logger.warn("whatsapp.template.failed", {
        template: input.templateName,
        tenant_id: input.tenantId,
        phone: maskWhatsAppPhone(normalizedPhone),
        retryable: error instanceof WhatsAppProviderError ? error.retryable : false,
        error_code: error?.providerCode || error?.code || "WHATSAPP_SEND_FAILED",
        error: String(error?.message || error),
      });

      throw error;
    }
  }

  private async reserveDelivery(
    input: WhatsAppTemplateDeliveryInput,
    normalizedPhone: string
  ): Promise<ReservationRow | null> {
    const obligationId = input.obligationId || null;
    const ownerId = input.ownerId || null;
    const tenantId = input.tenantId || null;
    const hostelId = input.hostelId || null;

    const rows = await prisma.$queryRaw<ReservationRow[]>`
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
        ${normalizedPhone},
        ${input.templateName},
        ${input.templateName},
        ${obligationId}::uuid,
        ${ownerId}::uuid,
        ${tenantId}::uuid,
        ${hostelId}::uuid,
        'PENDING',
        'PENDING',
        ${input.idempotencyKey},
        0
      )
      ON CONFLICT (idempotency_key) DO NOTHING
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

export const whatsAppTemplateDeliveryService = new WhatsAppTemplateDeliveryService();
