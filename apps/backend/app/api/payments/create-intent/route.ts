export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { apiError } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { assertBodySize, getClientIp, parseObligationIds } from "@/lib/security/api-guard";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

const logger = getLogger("create-intent");

const MAX_ADVANCE_AMOUNT = 1_000_000; // ₹10 Lakhs cap

export async function POST(req: Request) {
  try {
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const user = await authService.getCurrentUser(req);
    if (!user) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    const ip = getClientIp(req) || "unknown";
    const paymentLimit = await rateLimitService.checkStatelessLimit({
      scope: "payment:create-intent",
      identifier: `${user.id}:${ip}`,
      maxAttempts: 10,
      windowSeconds: 5 * 60,
    });
    if (!paymentLimit.allowed) {
      return apiError(
        "Too many payment attempts. Please wait a few minutes and try again.",
        "RATE_LIMITED",
        429,
      );
    }

    const body = await req.json().catch(() => ({}));
    const { obligation_ids, allowed_obligation_ids, payment_type = "RENT", amount } = body;

    // Resolve tenant record (needed for both paths)
    let tenantId: string | undefined;
    if (user.role === "TENANT") {
      const tenant = await prisma.tenants.findFirst({
        where: liveTenancyWhere(user.id),
        select: { id: true },
      });
      if (!tenant) return apiError("Tenant enrollment not found", "NOT_FOUND", 404);
      tenantId = tenant.id;
    } else if (user.role === "OWNER" && body.tenant_id) {
      const tenant = await prisma.tenants.findUnique({
        where: { id: String(body.tenant_id) },
        select: { id: true, owner_id: true },
      });
      if (!tenant) return apiError("Tenant enrollment not found", "NOT_FOUND", 404);
      if (tenant.owner_id !== user.id) return apiError("Forbidden", "FORBIDDEN", 403);
      tenantId = tenant.id;
    }

    // ── ADVANCE / DEPOSIT payment intents ─────────────────────────────────
    if (payment_type === "ADVANCE" || payment_type === "DEPOSIT" || payment_type === "FUTURE_RENT_CREDIT" || payment_type === "SECURITY_DEPOSIT") {
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return apiError(`amount is required and must be positive for ${payment_type} payments`, "VALIDATION_ERROR", 400);
      }
      if (amount > MAX_ADVANCE_AMOUNT) {
        return apiError(`amount cannot exceed ₹${MAX_ADVANCE_AMOUNT.toLocaleString("en-IN")}`, "VALIDATION_ERROR", 400);
      }
      if (!tenantId) {
        return apiError(`Only tenants can initiate ${String(payment_type).toLowerCase()} payments`, "FORBIDDEN", 403);
      }
      // Derive ownerId: tenant's owner
      const tenant = await prisma.tenants.findUnique({ where: { id: tenantId }, select: { owner_id: true } });
      if (!tenant?.owner_id) return apiError("Tenant has no owner assigned", "NOT_FOUND", 404);

      logger.info("create_ledger_intent_called", { userId: user.id, tenantId, amount, payment_type });
      const result = (payment_type === "DEPOSIT" || payment_type === "SECURITY_DEPOSIT")
        ? await paymentService.createDepositPaymentIntent({
            tenantId,
            ownerId: tenant.owner_id,
            amount,
            profileId: user.id,
          })
        : await paymentService.createAdvancePaymentIntent({
            tenantId,
            ownerId: tenant.owner_id,
            amount,
            profileId: user.id,
          });
      logger.info("ledger_intent_ready", { attemptId: result.id, checkoutUrl: result.checkout_url ? "present" : "missing", payment_type });
      return NextResponse.json(result);
    }

    if (payment_type === "RENT" && amount !== undefined && amount !== null) {
      if (typeof amount !== "number" || amount <= 0) {
        return apiError("amount must be a positive number for rent payments", "VALIDATION_ERROR", 400);
      }
      if (!tenantId) {
        return apiError("tenant_id is required for custom rent amount payments", "VALIDATION_ERROR", 400);
      }
      const tenant = await prisma.tenants.findUnique({
        where: { id: tenantId },
        select: { owner_id: true, hostel_id: true },
      });
      if (!tenant?.owner_id) return apiError("Tenant has no owner assigned", "NOT_FOUND", 404);
      if (!tenant.hostel_id) return apiError("Tenant is not assigned to a hostel", "VALIDATION_ERROR", 400);

      // Load obligations and validate amount against policy
      const plan = await financialPaymentFacade.previewSettlement({
        tenantId,
        hostelId: tenant.hostel_id,
        amountRupees: amount,
        obligationIdFilter: allowed_obligation_ids && allowed_obligation_ids.length > 0 ? allowed_obligation_ids : undefined,
        plannerAllowedObligationIds: allowed_obligation_ids,
      });

      if (!plan.payment_accepted) {
        return apiError(plan.rejection_reason || "Payment amount too low", "VALIDATION_ERROR", 400);
      }

      const result = await paymentService.createTenantRentPaymentIntent({
        tenantId,
        ownerId: tenant.owner_id,
        amount,
        profileId: user.id,
        allowedObligationIds: allowed_obligation_ids,
      });
      return NextResponse.json(result);
    }

    // ── RENT / MAINTENANCE intent (obligation-based) ──────────────────────
    // Validate + cap + UUID-check the ids array
    const { ids, error: idsError } = parseObligationIds(obligation_ids, 20);
    if (idsError) return idsError;

    logger.info("create_intent_called", {
      userId: user.id,
      userRole: user.role,
      payment_type,
      obligationCount: ids.length,
      obligationIds: ids,
    });

    const raw = await paymentService.createMultiObligationPaymentIntent(ids, user.id, tenantId);
    // Normalize: dedup path returns {attempt, isReused: true, ...}; new path returns PaymentAttempt directly
    const result = (raw as any).isReused === true ? (raw as any).attempt : raw;

    logger.info("redirecting_to_checkout", {
      attemptId: result.id,
      merchantTxnId: result.merchant_txn_id,
      checkoutUrl: result.checkout_url ? "present" : "missing",
      amount: result.amount,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error creating payment intent:", error);
    const message = String(error?.message ?? error);
    if (message.includes("FORBIDDEN")) return apiError(message.replace("FORBIDDEN: ", ""), "FORBIDDEN", 403);
    if (message.includes("NOT_FOUND")) return apiError(message.replace("NOT_FOUND: ", ""), "NOT_FOUND", 404);
    if (message.includes("BAD_REQUEST")) return apiError(message.replace("BAD_REQUEST: ", ""), "VALIDATION_ERROR", 400);
    if (message.includes("CONFIG_ERROR")) return apiError(message.replace("CONFIG_ERROR: ", ""), "CONFIG_ERROR", 422);
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
