export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { apiError, apiResponse } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { getLogger } from "@/lib/logger";

const logger = getLogger("payments.manual-confirm");

const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const RATE_LIMIT_MAX       = 5;       // max confirms per window

/**
 * POST /api/payments/manual-confirm
 *
 * Owner manually confirms a PENDING_MANUAL_CONFIRMATION payment attempt.
 * Owner override for gateway payments that require explicit manual approval
 * before the obligation is marked PAID.
 *
 * Security guarantees:
 *  - JWT auth required — OWNER or ADMIN only
 *  - attempt.owner_id must match session user (no cross-owner access)
 *  - Attempt must be in PENDING_MANUAL_CONFIRMATION (idempotent on SUCCESS)
 *  - source="MANUAL_CONFIRM" is set server-side — never trusted from client input
 *  - DB-based rate limit: max 5 confirmations per 10 s per owner
 *  - Concurrent double-clicks blocked by atomic PROCESSING lock in finalizePaymentAttempt
 *  - Full audit trail written to payment_attempts (confirmed_by, confirmed_at, ip)
 */
export async function POST(req: Request) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      console.warn("[payments.manual-confirm] Unauthorized access attempt");
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }
    
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      console.warn(`[payments.manual-confirm] Forbidden access attempt by ${user.role} ${user.id}`);
      return apiError("Only owners can confirm payments", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({}));
    const { attempt_id } = body;
    
    console.log(`[payments.manual-confirm] Confirming attempt ${attempt_id} for owner ${user.id}`, body);

    if (!attempt_id || typeof attempt_id !== "string") {
      return apiError("attempt_id is required", "VALIDATION_ERROR", 400);
    }

    // ── Rate limit (DB-based, TTL-safe) ───────────────────────────────────────
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recent = await prisma.actionLog.count({
      where: { owner_id: user.id, action: "MANUAL_CONFIRM", created_at: { gte: windowStart } },
    });
    
    if (recent >= RATE_LIMIT_MAX) {
      logger.warn("payments.manual_confirm.rate_limited", { owner_id: user.id });
      return apiError("Too many confirmation requests. Please wait a moment.", "RATE_LIMIT", 429);
    }

    // Log before processing — counts even if the attempt below fails
    await prisma.actionLog.create({
      data: { id: randomUUID(), owner_id: user.id, action: "MANUAL_CONFIRM" },
    });

    // ── Fetch & validate attempt ───────────────────────────────────────────────
    const attempt = await prisma.paymentAttempt.findUnique({ where: { id: attempt_id } });
    if (!attempt) return apiError("Payment attempt not found", "NOT_FOUND", 404);

    // 🔒 Ownership — owner can only touch their own hostel's payments
    if (attempt.owner_id !== user.id) {
      logger.warn("payments.manual_confirm.forbidden", {
        session_owner: user.id,
        attempt_owner: attempt.owner_id,
        attempt_id,
      });
      return apiError("You can only confirm payments for your own hostel", "FORBIDDEN", 403);
    }

    // Idempotent: already finalized
    if (attempt.status === "SUCCESS") {
      return apiResponse({ 
        success: true, 
        message: "Payment already confirmed", 
        attempt 
      });
    }

    // 🔒 Status gate — only park-status attempts qualify
    if ((attempt.status as string) !== "PENDING_MANUAL_CONFIRMATION") {
      return apiError(
        `Attempt is in status '${attempt.status}'. Only PENDING_MANUAL_CONFIRMATION attempts can be manually confirmed.`,
        "BAD_REQUEST",
        400
      );
    }

    // ── Extract client IP for audit trail ─────────────────────────────────────
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    logger.info("payments.manual_confirm.start", {
      attempt_id,
      owner_id: user.id,
      amount: Number(attempt.amount),
      merchant_txn_id: attempt.merchant_txn_id,
      ip: clientIp,
    });

    const finalized = await paymentService.finalizePaymentAttempt(
      attempt_id,
      "SUCCESS",
      attempt.gateway_txn_id || undefined,
      { source: "manual_confirm_route", confirmed_at: new Date().toISOString() },
      {
        source: "MANUAL_CONFIRM",
        actor: { id: user.id, ip: clientIp ?? undefined },
      }
    );

    await eventLog.log("PAYMENT_MANUALLY_CONFIRMED", user.id, {
      attempt_id,
      merchant_txn_id: attempt.merchant_txn_id,
      amount: Number(attempt.amount),
      tenant_id: attempt.tenant_id,
      ip: clientIp,
    });

    logger.info("payments.manual_confirm.success", {
      attempt_id,
      owner_id: user.id,
      final_status: finalized?.status,
    });

    console.log(`[payments.manual-confirm] Payment confirmed successfully for attempt ${attempt_id}`);
    return apiResponse({
      success: true,
      message: "Payment confirmed. Rent obligation marked as paid.",
      attempt: finalized,
    });
  } catch (error: any) {
    console.error("Detailed API Error [payments.manual-confirm]:", error);
    logger.error("payments.manual_confirm.failed", { error: error.message });
    const msg = String(error?.message ?? error);
    
    if (msg.includes("FORBIDDEN"))   return apiError(msg, "FORBIDDEN", 403);
    if (msg.includes("NOT_FOUND"))   return apiError(msg, "NOT_FOUND", 404);
    if (msg.includes("BAD_REQUEST")) return apiError(msg, "BAD_REQUEST", 400);
    if (msg.includes("RATE_LIMIT"))  return apiError(msg, "RATE_LIMIT", 429);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
