export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { apiError } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }
    if (user.role !== "OWNER") {
      return apiError("Only owner can reconcile attempts", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({} as any));
    const hostelId = typeof body?.hostelId === "string" ? body.hostelId : undefined;
    const domain = typeof body?.paymentDomain === "string" ? body.paymentDomain : undefined;
    const ids = Array.isArray(body?.payment_ids)
      ? body.payment_ids.filter((v: any) => typeof v === "string" && v.trim().length > 0)
      : [];

    if (!hostelId) {
      return apiError("hostelId is required for reconciliation", "BAD_REQUEST", 400);
    }
    const hostel = await prisma.hostels.findUnique({
      where: { id: hostelId },
      select: { id: true, owner_id: true },
    });
    if (!hostel || hostel.owner_id !== user.id) {
      return apiError("Hostel not found or access denied", "FORBIDDEN", 403);
    }

    const result = await paymentService.reconcilePendingAttempts({
      ownerId: user.id,
      hostelId: hostelId,
      paymentDomain: domain,
      attemptIds: ids,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error reconciling pending attempts:", error);
    const message = String(error?.message ?? error);
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
