export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { apiError } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { paymentStatusEventService } from "@/lib/services/payment-status-event-service";
import { SETTLEMENT_STATUS } from "@/src/services/payments/financial-domain";

/**
 * POST /api/payments/confirm
 * 
 * Owner confirms or rejects a PENDING_VERIFICATION payment.
 * 
 * Body:
 *   { attempt_id: string, action: "confirm" | "reject" }
 * 
 * On confirm: attempt → SUCCESS, records payment, marks rent PAID
 * On reject:  attempt → FAILED
 */
export async function POST(req: Request) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return apiError("Only owners can confirm payments", "FORBIDDEN", 403);
    }

    const body = await req.json();
    const { attempt_id, action } = body;

    if (!attempt_id) {
      return apiError("attempt_id is required", "VALIDATION_ERROR", 400);
    }
    if (!action || !["confirm", "reject"].includes(action)) {
      return apiError("action must be 'confirm' or 'reject'", "VALIDATION_ERROR", 400);
    }

    // Verify ownership
    const attempt = await prisma.paymentAttempt.findUnique({
      where: { id: attempt_id },
    });

    if (!attempt) {
      return apiError("Payment attempt not found", "NOT_FOUND", 404);
    }

    if (attempt.owner_id !== user.id) {
      return apiError("FORBIDDEN: You can only manage your own hostel's payments", "FORBIDDEN", 403);
    }

    if (attempt.status === "SUCCESS") {
      return NextResponse.json({
        message: "Payment already confirmed",
        attempt,
      });
    }

    const CONFIRMABLE = ["PENDING_MANUAL_CONFIRMATION"];
    if (!CONFIRMABLE.includes(attempt.status) && action === "confirm") {
      return apiError(
        `Cannot confirm a payment in status '${attempt.status}'. Expected PENDING_MANUAL_CONFIRMATION.`,
        "BAD_REQUEST",
        400
      );
    }

    if (action === "confirm") {
      // Finalize as SUCCESS — records the payment and updates obligation.
      // Owner can always settle a parked PENDING_MANUAL_CONFIRMATION attempt.
      const clientIp =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        undefined;

      const finalized = await paymentService.finalizePaymentAttempt(
        attempt_id,
        "SUCCESS",
        attempt.gateway_txn_id || undefined,
        { source: "confirm_route", confirmed_at: new Date().toISOString() },
        {
          source: "MANUAL_CONFIRM",
          actor: { id: user.id, ip: clientIp },
        }
      );

      return NextResponse.json({
        message: "Payment confirmed successfully. Rent marked as paid.",
        attempt: finalized,
      });
    } else {
      // Reject — mark as FAILED
      const rejected = await prisma.$transaction(async (tx) => {
        const updated = await paymentStatusEventService.updateAttemptStatus(tx, {
          attemptId: attempt_id,
          fromStatus: attempt.status,
          toStatus: "FAILED",
          source: "MANUAL_REJECT",
          reason: "owner rejected manual payment review",
          actorId: user.id,
          operationalOwnerId: attempt.owner_id,
          financialOwnerId: attempt.owner_id,
          hostelId: attempt.hostel_id,
          data: {
            settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE,
            raw_webhook_payload: {
              ...(attempt.raw_webhook_payload as any || {}),
              rejection: {
                rejected_by: user.id,
                rejected_at: new Date().toISOString(),
              },
            } as any,
          },
        });
        return updated;
      });

      return NextResponse.json({
        message: "Payment rejected.",
        attempt: rejected,
      });
    }
  } catch (error: any) {
    console.error("Error confirming payment:", error);
    const message = String(error?.message ?? error);
    if (message.includes("FORBIDDEN")) return apiError(message, "FORBIDDEN", 403);
    if (message.includes("NOT_FOUND")) return apiError(message, "NOT_FOUND", 404);
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
