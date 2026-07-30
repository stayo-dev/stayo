import crypto from "crypto";
import { prisma } from "../db";
import { getLogger } from "../logger";

const logger = getLogger("payment.webhook-event");

export function computeWebhookEventHash(provider: string, rawBody: string) {
  return crypto
    .createHash("sha256")
    .update(`${provider.toUpperCase()}:${rawBody}`)
    .digest("hex");
}

export function redactWebhookHeaders(headers: Record<string, string>) {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (["authorization", "cookie", "set-cookie", "x-verify"].includes(lower)) {
      redacted[key] = value ? "[REDACTED]" : "";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function parseJson(rawBody: string) {
  try {
    return JSON.parse(rawBody);
  } catch {
    return { raw: rawBody };
  }
}

export class PaymentWebhookEventService {
  async recordReceived(input: {
    provider: string;
    rawBody: string;
    headers: Record<string, string>;
    signatureVerified: boolean;
    signatureAlgorithm?: string | null;
    signatureFailureReason?: string | null;
    merchantTransactionId?: string | null;
  }) {
    const provider = input.provider.toUpperCase();
    const eventHash = computeWebhookEventHash(provider, input.rawBody);
    const rawPayload = parseJson(input.rawBody);
    const merchantTransactionId =
      input.merchantTransactionId ||
      rawPayload?.payload?.merchantOrderId ||
      rawPayload?.merchantOrderId ||
      null;

    try {
      const existing = await (prisma as any).paymentWebhookEvent.findUnique({
        where: { event_hash: eventHash },
      });
      if (existing) return { event: existing, duplicate: true, eventHash };

      const attempt = merchantTransactionId
        ? await prisma.paymentAttempt.findFirst({
            where: {
              OR: [
                { merchant_txn_id: merchantTransactionId },
                { merchant_transaction_id: merchantTransactionId },
              ],
            },
            select: {
              id: true,
              owner_id: true,
              hostel_id: true,
              payment_domain: true,
              flow_type: true,
              merchant_context_type: true,
              merchant_context_id: true,
              merchant_transaction_id: true,
              provider_transaction_id: true,
              provider_order_id: true,
              provider_reference_id: true,
            } as any,
          })
        : null;

      const event = await (prisma as any).paymentWebhookEvent.create({
        data: {
          id: crypto.randomUUID(),
          provider,
          payment_domain: (attempt as any)?.payment_domain || null,
          flow_type: (attempt as any)?.flow_type || null,
          merchant_context_type: (attempt as any)?.merchant_context_type || null,
          merchant_context_id: (attempt as any)?.merchant_context_id || null,
          merchant_transaction_id: merchantTransactionId,
          provider_transaction_id: (attempt as any)?.provider_transaction_id || null,
          provider_order_id: (attempt as any)?.provider_order_id || null,
          provider_reference_id: (attempt as any)?.provider_reference_id || null,
          event_hash: eventHash,
          raw_payload: rawPayload,
          headers_redacted: redactWebhookHeaders(input.headers),
          processing_status: "RECEIVED",
          payment_attempt_id: attempt?.id || null,
          operational_owner_id: attempt?.owner_id || null,
          financial_owner_id: attempt?.owner_id || null,
          hostel_id: attempt?.hostel_id || null,
          signature_verified: input.signatureVerified,
          signature_algorithm: input.signatureAlgorithm || null,
          signature_failure_reason: input.signatureFailureReason || null,
        },
      });

      return { event, duplicate: false, eventHash };
    } catch (error: any) {
      logger.error("webhook_event.record_failed", { provider, error: error?.message || String(error) });
      throw error;
    }
  }

  async markProcessing(id: string) {
    return (prisma as any).paymentWebhookEvent.update({
      where: { id },
      data: { processing_status: "PROCESSING" },
    });
  }

  async markProcessed(id: string, result: any) {
    return (prisma as any).paymentWebhookEvent.update({
      where: { id },
      data: {
        processing_status: "PROCESSED",
        processing_result: result || null,
        processed_at: new Date(),
      },
    });
  }

  async markFailed(id: string, error: string, status = "FAILED") {
    return (prisma as any).paymentWebhookEvent.update({
      where: { id },
      data: {
        processing_status: status,
        error_message: error,
        processed_at: new Date(),
      },
    });
  }
}

export const paymentWebhookEventService = new PaymentWebhookEventService();
