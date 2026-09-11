export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/subscriptions/[id]/activate-founding
 *
 * Phase-1 "Mark as Paid & Activate" — the client already paid ₹2,000
 * outside Stayo; this records that payment and approves it in one admin
 * action. FOUNDING only (rejects with NOT_FOUNDING otherwise) — plan code,
 * price, included beds and the one-month period are all derived server-side
 * from the owner's subscription + the canonical `subscription_plans` row,
 * never from the request body. Body: { reference?: string }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const result = await subscriptionPaymentService.markFoundingPaidAndActivate({
      subscriptionId: id,
      adminId: (session as any).sub,
      reference: typeof body?.reference === "string" ? body.reference : null,
    });
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscriptions.activate-founding");
  }
}
