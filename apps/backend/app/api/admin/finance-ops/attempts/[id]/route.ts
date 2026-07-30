export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access required", "FORBIDDEN", 403);
  }

  try {
    const attempt = await prisma.paymentAttempt.findFirst({
      where: {
        OR: [
          { id: params.id },
          { merchant_txn_id: params.id },
          { merchant_transaction_id: params.id },
          { gateway_txn_id: params.id },
          { provider_transaction_id: params.id },
          { provider_order_id: params.id },
          { provider_reference_id: params.id },
        ],
      },
      include: {
        payments: {
          include: {
            receipts: true,
            obligation: {
              select: {
                id: true,
                amount: true,
                status: true,
                hostel_id: true,
                rent_month: true,
                obligation_type: true,
              },
            },
          },
        },
        obligations: true,
        invoice: true,
      },
    });

    if (!attempt) return apiError("Payment attempt not found", "NOT_FOUND", 404);

    const [
      statusEvents,
      webhookEvents,
      providerSnapshots,
      anomalies,
      reconciliationItems,
    ] = await Promise.all([
      (prisma as any).paymentAttemptStatusEvent.findMany({
        where: { payment_attempt_id: attempt.id },
        orderBy: { transition_sequence: "asc" },
      }),
      (prisma as any).paymentWebhookEvent.findMany({
        where: { payment_attempt_id: attempt.id },
        orderBy: { received_at: "desc" },
        take: 50,
      }),
      (prisma as any).paymentProviderVerificationSnapshot.findMany({
        where: { payment_attempt_id: attempt.id },
        orderBy: { verified_at: "desc" },
        take: 50,
      }),
      (prisma as any).paymentOperationalAnomaly.findMany({
        where: { payment_attempt_id: attempt.id },
        orderBy: { detected_at: "desc" },
      }),
      (prisma as any).paymentReconciliationItem.findMany({
        where: { payment_attempt_id: attempt.id },
        orderBy: { created_at: "desc" },
        take: 50,
      }),
    ]);

    return apiResponse({
      attempt,
      status_events: statusEvents,
      webhook_events: webhookEvents,
      provider_snapshots: providerSnapshots,
      anomalies,
      reconciliation_items: reconciliationItems,
    });
  } catch (error: any) {
    console.error("[FINANCE_OPS_ATTEMPT_DETAIL]", error);
    return apiError(error?.message || "Failed to fetch payment attempt detail");
  }
}
