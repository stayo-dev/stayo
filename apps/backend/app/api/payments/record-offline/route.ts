export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { verifyIdentityConfirmation } from "@/src/services/payments/identity-confirmation-guard";
import { apiError, apiResponse } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const IDENTITY_PURPOSE     = "OFFLINE_PAYMENT";
const IDENTITY_ACTION      = "record_offline_payment";
const ANOMALY_DAILY_LIMIT  = 20; // soft-warn if owner records more than this per day

const logger = getLogger("payments.record-offline");

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX       = 5;

/**
 * POST /api/payments/record-offline
 *
 * Step 2 of secure offline payment flow.
 * Records a manual (cash / bank transfer / UPI) payment against a rent obligation.
 *
 * Security guarantees (in order of enforcement):
 *  1. Session JWT required (middleware)
 *  2. Identity token required — MUST carry purpose="OFFLINE_PAYMENT" signed with JWT_SECRET
 *  3. Identity token userId MUST match session user (token cannot be passed between owners)
 *  4. DB-based rate limit — max 5 recordings per 10 s per owner
 *  5. Ownership check — obligation.owner_id must equal session user (cross-owner blocked)
 *  6. Idempotency — obligation already PAID → return without creating a duplicate
 *  7. Atomic lock via _applyPaymentInTx FOR UPDATE on obligation row
 *  8. Full audit trail written atomically with the payment record
 */
export async function POST(req: Request) {
  try {
    // ── 1. Session auth ────────────────────────────────────────────────────────
    const user = await authService.getCurrentUser(req);
    if (!user) {
      console.warn("[payments.record-offline] Unauthorized access attempt");
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }
    
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      console.warn(`[payments.record-offline] Forbidden access attempt by ${user.role} ${user.id}`);
      return apiError("Only owners can record offline payments", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({}));
    const {
      identity_token,
      obligation_id,
      tenant_id,
      amount_paid,
      payment_method,
      reference_number,
      payment_date,
      note,
      allowedObligationIds,
      allowed_obligation_ids,
    } = body;
    const targetObligationIds = allowedObligationIds || allowed_obligation_ids;
    const hostelId = body.hostelId || body.hostel_id;
    
    console.log(`[payments.record-offline] Recording payment for owner ${user.id}, hostel ${hostelId}`, body);

    let effectiveHostelId = hostelId;

    // ── 2 + 3. Identity token verification ────────────────────────────────────
    const identity = await verifyIdentityConfirmation(identity_token, IDENTITY_PURPOSE, IDENTITY_ACTION, user.id);

    // ── 4. Rate limit ─────────────────────────────────────────────────────────
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recent = await prisma.actionLog.count({
      where: { owner_id: user.id, action: "OFFLINE_PAYMENT", created_at: { gte: windowStart } },
    });
    
    if (recent >= RATE_LIMIT_MAX) {
      logger.warn("payments.record_offline.rate_limited", { owner_id: user.id });
      return apiError("Too many payment recordings. Please wait a moment.", "RATE_LIMIT", 429);
    }
    await prisma.actionLog.create({
      data: { id: randomUUID(), owner_id: user.id, action: "OFFLINE_PAYMENT" },
    });

    // ── Input validation ───────────────────────────────────────────────────────
    if ((!obligation_id || typeof obligation_id !== "string") && (!tenant_id || typeof tenant_id !== "string")) {
      return apiError("obligation_id or tenant_id is required", "VALIDATION_ERROR", 400);
    }
    const parsedAmount = Number(amount_paid);
    if (!parsedAmount || parsedAmount <= 0) {
      return apiError("amount_paid must be a positive number", "VALIDATION_ERROR", 400);
    }
    const validMethods = ["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "OTHER"];
    const method = String(payment_method || "CASH").toUpperCase();
    if (!validMethods.includes(method)) {
      return apiError(`payment_method must be one of: ${validMethods.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    // ── 5. Ownership check ─────────────────────────────────────────────────────
    let tenantObj = null;
    if (tenant_id) {
      tenantObj = await prisma.tenants.findUnique({
        where: { id: tenant_id },
        select: { owner_id: true, hostel_id: true },
      });
      if (!tenantObj) return apiError("Tenant not found", "NOT_FOUND", 404);
      if (tenantObj.owner_id !== user.owner_id && tenantObj.owner_id !== user.id) {
        return apiError("You can only record payments for your own tenants", "FORBIDDEN", 403);
      }
      if (hostelId && tenantObj.hostel_id !== hostelId) {
        return apiError("Tenant does not belong to requested hostel", "HOSTEL_ACCESS_DENIED", 403);
      }
      effectiveHostelId = tenantObj.hostel_id;
    }

    let obligationObj = null;
    if (obligation_id) {
      obligationObj = await prisma.rent_obligations.findUnique({
        where: { id: obligation_id },
        select: { owner_id: true, hostel_id: true, status: true },
      });
      if (!obligationObj) return apiError("Obligation not found", "NOT_FOUND", 404);
      if (obligationObj.owner_id !== user.owner_id && obligationObj.owner_id !== user.id) {
        logger.warn("payments.record_offline.cross_owner", {
          session_owner: user.owner_id ?? user.id,
          obligation_owner: obligationObj.owner_id,
          obligation_id,
        });
        return apiError("You can only record payments for your own tenants", "FORBIDDEN", 403);
      }
      if (hostelId && obligationObj.hostel_id !== hostelId) {
        return apiError("Obligation does not belong to requested hostel", "HOSTEL_ACCESS_DENIED", 403);
      }
      effectiveHostelId = obligationObj.hostel_id;
    }

    if (!effectiveHostelId) {
      return apiError("Cannot determine hostel context", "HOSTEL_CONTEXT_REQUIRED", 400);
    }

    // ── 6. Idempotency — already fully paid ───────────────────────────────────
    if (obligation_id && obligationObj?.status === "PAID") {
      return apiResponse({
        success: true,
        message: "Obligation is already fully paid.",
        idempotent: true,
      });
    }

    // ── Extract client IP for audit trail ─────────────────────────────────────
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    logger.info("payments.record_offline.start", {
      obligation_id,
      amount: parsedAmount,
      method,
      owner_id: user.id,
      ip: clientIp,
    });

    // ── Anomaly detection (soft guard — logs + warns, does not block) ─────────
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayCount = await prisma.actionLog.count({
      where: { owner_id: user.id, action: "OFFLINE_PAYMENT", created_at: { gte: dayStart } },
    });
    
    if (todayCount >= ANOMALY_DAILY_LIMIT) {
      logger.warn("payments.record_offline.anomaly", {
        owner_id: user.id,
        today_count: todayCount,
        threshold: ANOMALY_DAILY_LIMIT,
        obligation_id,
        amount: parsedAmount,
      });
    }

    // ── 7 + 8. Atomic: consume identity token + write payment in ONE transaction ─
    const parsedDate = payment_date ? new Date(payment_date) : undefined;
    if (parsedDate) {
      if (Number.isNaN(parsedDate.getTime())) {
        return apiError("payment_date is not a valid date", "VALIDATION_ERROR", 400);
      }
      // A payment can't have happened in the future. Compare on the calendar
      // day (UTC) so "today" in any timezone is accepted.
      const todayEnd = new Date();
      todayEnd.setUTCHours(23, 59, 59, 999);
      if (parsedDate.getTime() > todayEnd.getTime()) {
        return apiError("payment_date cannot be in the future", "VALIDATION_ERROR", 400);
      }
    }

    let resolvedTenantId = tenant_id;
    if (!resolvedTenantId && targetObligationIds && targetObligationIds.length > 0) {
      const firstOb = await prisma.rent_obligations.findUnique({
        where: { id: targetObligationIds[0] },
        select: { tenant_id: true },
      });
      resolvedTenantId = firstOb?.tenant_id || "";
    }

    const useTenantFlow = (resolvedTenantId && !obligation_id) || (targetObligationIds && targetObligationIds.length > 0);

    const result = useTenantFlow
      ? await paymentService.recordTenantRentPaymentWithToken(identity.jti, {
          hostelId: effectiveHostelId,
          tenantId: resolvedTenantId || "",
          amountPaid: parsedAmount,
          paymentMethod: method,
          referenceNumber: reference_number || undefined,
          paymentDate: parsedDate,
          userId: user.id,
          ownerId: user.owner_id || user.id,
          offlineRecordedBy: user.id,
          offlineRecordedAt: new Date(),
          offlineRecordedIp: clientIp ?? undefined,
          offlineNote: note || undefined,
          idempotencyKey: body.idempotency_key || undefined,
          allowedObligationIds: targetObligationIds,
        })
      : await paymentService.recordOfflinePaymentWithToken(identity.jti, {
          hostelId: effectiveHostelId,
          obligationId: obligation_id,
          amountPaid: parsedAmount,
          paymentMethod: method,
          referenceNumber: reference_number || undefined,
          paymentDate: parsedDate,
          userId: user.id,
          ownerId: user.owner_id || user.id,
          offlineRecordedBy: user.id,
          offlineRecordedAt: new Date(),
          offlineRecordedIp: clientIp ?? undefined,
          offlineNote: note || undefined,
        });

    logger.info("payments.record_offline.success", {
      obligation_id,
      payment_id: (result as any).payment?.id || null,
      amount: parsedAmount,
      method,
      new_status: (result as any).newStatus || (result as any).overallStatus,
    });

    console.log(`[payments.record-offline] Payment recorded successfully for obligation ${obligation_id}`);
    return apiResponse({
      success: true,
      message: "Payment recorded successfully.",
      payment: (result as any).payment || null,
      obligation_status: (result as any).newStatus || (result as any).overallStatus,
      payment_group_id: (result as any).groupId || null,
      allocations: (result as any).allocations || undefined,
      future_credit: 0, // ADR-036: retained for response-shape compatibility
      settlement_breakdown: (result as any).settlementBreakdown || null,
    });
  } catch (error: any) {
    console.error("Detailed API Error [payments.record-offline]:", error);
    logger.error("payments.record_offline.failed", { error: error.message });
    const msg = String(error?.message ?? error);
    
    if (msg.includes("NOT_FOUND"))      return apiError(msg, "NOT_FOUND", 404);
    if (msg.includes("BAD_REQUEST"))    return apiError(msg, "BAD_REQUEST", 400);
    if (msg.includes("IDENTITY_REQUIRED")) return apiError(msg.replace("IDENTITY_REQUIRED: ", ""), "IDENTITY_REQUIRED", 403);
    if (msg.includes("IDENTITY_EXPIRED"))  return apiError(msg.replace("IDENTITY_EXPIRED: ", ""), "IDENTITY_EXPIRED", 403);
    if (msg.includes("FORBIDDEN"))      return apiError(msg, "FORBIDDEN", 403);
    if (msg.includes("UNAUTHORIZED"))   return apiError(msg, "UNAUTHORIZED", 401);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
