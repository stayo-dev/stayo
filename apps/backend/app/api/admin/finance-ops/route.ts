export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function since(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access required", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get("days") || 7), 1), 90);
  const from = since(days);

  try {
    const [
      attemptsByStatus,
      attemptsByDomain,
      webhooksByStatus,
      webhookSignatureFailures,
      openAnomaliesBySeverity,
      openAnomaliesByType,
      latestReconciliationRuns,
      staleLocks,
      orphanSuccess,
    ] = await Promise.all([
      prisma.paymentAttempt.groupBy({
        by: ["status"],
        where: { created_at: { gte: from } },
        _count: { _all: true },
      }),
      prisma.paymentAttempt.groupBy({
        by: ["payment_domain"],
        where: { created_at: { gte: from } },
        _count: { _all: true },
      }),
      (prisma as any).paymentWebhookEvent.groupBy({
        by: ["processing_status"],
        where: { received_at: { gte: from } },
        _count: { _all: true },
      }),
      (prisma as any).paymentWebhookEvent.count({
        where: { received_at: { gte: from }, signature_verified: false },
      }),
      (prisma as any).paymentOperationalAnomaly.groupBy({
        by: ["severity"],
        where: { status: "OPEN" },
        _count: { _all: true },
      }),
      (prisma as any).paymentOperationalAnomaly.groupBy({
        by: ["anomaly_type"],
        where: { status: "OPEN" },
        _count: { _all: true },
      }),
      (prisma as any).paymentReconciliationRun.findMany({
        orderBy: { started_at: "desc" },
        take: 10,
      }),
      prisma.paymentAttempt.count({
        where: {
          status: { in: ["PROCESSING", "PENDING_VERIFICATION"] },
          updated_at: { lt: new Date(Date.now() - 5 * 60 * 1000) },
        },
      }),
      prisma.paymentAttempt.count({
        where: {
          status: "SUCCESS",
          payment_domain: "RENT_COLLECTION",
          flow_type: "RENT",
          payments: { none: {} },
        },
      }),
    ]);

    return apiResponse({
      window_days: days,
      attempts_by_status: attemptsByStatus,
      attempts_by_domain: attemptsByDomain,
      webhooks_by_status: webhooksByStatus,
      webhook_signature_failures: webhookSignatureFailures,
      open_anomalies_by_severity: openAnomaliesBySeverity,
      open_anomalies_by_type: openAnomaliesByType,
      latest_reconciliation_runs: latestReconciliationRuns,
      stuck_payment_locks: staleLocks,
      orphan_success_attempts: orphanSuccess,
    });
  } catch (error: any) {
    console.error("[FINANCE_OPS_SUMMARY]", error);
    return apiError(error?.message || "Failed to fetch finance operations summary");
  }
}
