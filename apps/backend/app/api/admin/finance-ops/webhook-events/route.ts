export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access required", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const processingStatus = searchParams.get("status") || undefined;
  const signatureVerified = searchParams.get("signatureVerified");
  const hostelId = searchParams.get("hostelId") || undefined;
  const attemptId = searchParams.get("attemptId") || undefined;
  const take = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 200);

  try {
    const events = await (prisma as any).paymentWebhookEvent.findMany({
      where: {
        ...(processingStatus ? { processing_status: processingStatus } : {}),
        ...(signatureVerified === "true" ? { signature_verified: true } : {}),
        ...(signatureVerified === "false" ? { signature_verified: false } : {}),
        ...(hostelId ? { hostel_id: hostelId } : {}),
        ...(attemptId ? { payment_attempt_id: attemptId } : {}),
      },
      orderBy: { received_at: "desc" },
      take,
    });

    return apiResponse({ events });
  } catch (error: any) {
    console.error("[FINANCE_OPS_WEBHOOK_EVENTS]", error);
    return apiError(error?.message || "Failed to fetch webhook events");
  }
}
