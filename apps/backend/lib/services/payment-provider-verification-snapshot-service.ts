import crypto from "crypto";
import { prisma } from "../db";
import { getLogger } from "../logger";

const logger = getLogger("payment.provider-snapshot");

function stableJson(value: any): string {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function hashProviderResponse(rawResponse: any) {
  return crypto.createHash("sha256").update(stableJson(rawResponse)).digest("hex");
}

export class PaymentProviderVerificationSnapshotService {
  async record(input: {
    provider: string;
    source: "WEBHOOK" | "VERIFY" | "RECONCILE" | "MANUAL_CONFIRM" | "SYSTEM";
    attempt?: any;
    paymentAttemptId?: string | null;
    webhookEventId?: string | null;
    reconciliationRunId?: string | null;
    merchantTransactionId?: string | null;
    providerTransactionId?: string | null;
    providerOrderId?: string | null;
    providerReferenceId?: string | null;
    providerStatus?: string | null;
    normalizedStatus: string;
    amount?: number | string | null;
    rawResponse?: any;
  }) {
    const attempt = input.attempt || null;
    const rawResponse = input.rawResponse || null;
    try {
      return await (prisma as any).paymentProviderVerificationSnapshot.create({
        data: {
          id: crypto.randomUUID(),
          provider: input.provider.toUpperCase(),
          payment_domain: attempt?.payment_domain || null,
          flow_type: attempt?.flow_type || null,
          source: input.source,
          payment_attempt_id: input.paymentAttemptId || attempt?.id || null,
          webhook_event_id: input.webhookEventId || null,
          reconciliation_run_id: input.reconciliationRunId || null,
          merchant_transaction_id: input.merchantTransactionId || attempt?.merchant_transaction_id || attempt?.merchant_txn_id || null,
          provider_transaction_id: input.providerTransactionId || null,
          provider_order_id: input.providerOrderId || null,
          provider_reference_id: input.providerReferenceId || null,
          provider_status: input.providerStatus || null,
          normalized_status: input.normalizedStatus,
          amount: input.amount == null ? null : Number(input.amount),
          raw_response: rawResponse,
          raw_response_hash: hashProviderResponse(rawResponse),
          operational_owner_id: attempt?.owner_id || null,
          financial_owner_id: attempt?.owner_id || null,
          hostel_id: attempt?.hostel_id || null,
        },
      });
    } catch (error: any) {
      logger.warn("provider_snapshot.record_failed", {
        payment_attempt_id: input.paymentAttemptId || attempt?.id || null,
        source: input.source,
        error: error?.message || String(error),
      });
      return null;
    }
  }
}

export const paymentProviderVerificationSnapshotService = new PaymentProviderVerificationSnapshotService();
