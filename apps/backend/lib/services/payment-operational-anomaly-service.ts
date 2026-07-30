import crypto from "crypto";
import { prisma } from "../db";
import { getLogger } from "../logger";

const logger = getLogger("payment.anomaly");
type MaybeHostelId = string | null;

export class PaymentOperationalAnomalyService {
  async create(input: {
    anomalyType: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    paymentDomain?: string | null;
    flowType?: string | null;
    paymentAttemptId?: string | null;
    paymentId?: string | null;
    webhookEventId?: string | null;
    reconciliationRunId?: string | null;
    operationalOwnerId?: string | null;
    financialOwnerId?: string | null;
    hostelId?: MaybeHostelId;
    metadata?: any;
  }) {
    try {
      return await (prisma as any).paymentOperationalAnomaly.create({
        data: {
          id: crypto.randomUUID(),
          anomaly_type: input.anomalyType,
          severity: input.severity,
          payment_domain: input.paymentDomain || null,
          flow_type: input.flowType || null,
          payment_attempt_id: input.paymentAttemptId || null,
          payment_id: input.paymentId || null,
          webhook_event_id: input.webhookEventId || null,
          reconciliation_run_id: input.reconciliationRunId || null,
          operational_owner_id: input.operationalOwnerId || null,
          financial_owner_id: input.financialOwnerId || null,
          hostel_id: input.hostelId || null,
          metadata: input.metadata || null,
        },
      });
    } catch (error: any) {
      logger.error("payment_anomaly.create_failed", {
        anomaly_type: input.anomalyType,
        error: error?.message || String(error),
      });
      return null;
    }
  }
}

export const paymentOperationalAnomalyService = new PaymentOperationalAnomalyService();
