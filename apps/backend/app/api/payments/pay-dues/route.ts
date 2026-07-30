export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { apiError } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { resolveTenantSettlementAccess } from "@/src/services/payments/tenant-access-guard";

/**
 * 💰 PAY DUES — FIFO payment allocation across all unpaid obligations
 *
 * POST /api/payments/pay-dues
 *
 * Body:
 *   {
 *     tenant_id: string,        // Required for owner; auto-resolved for tenant
 *     amount_paid: number,      // Total payment amount
 *     payment_method: string,   // "CASH" | "UPI" | "BANK_TRANSFER" etc.
 *     reference_number?: string,
 *     payment_date?: string     // ISO date string
 *   }
 *
 * Flow:
 *   1. Fetches ALL unpaid obligations (RENT + LATE_FEE) sorted by due_date ASC
 *   2. Allocates payment FIFO: oldest obligations first, RENT before LATE_FEE within same month
 *   3. Creates individual Payment records per obligation
 *   4. Creates receipts for each payment
 *   5. Returns full breakdown of what was paid
 *
 * Example: Tenant owes ₹8000 RENT + ₹500 LATE_FEE = ₹8500 total
 *   - Pay ₹8500 → Both marked PAID ✅
 *   - Pay ₹8000 → RENT marked PAID, LATE_FEE still PENDING (PARTIAL overall) ✅
 *   - Pay ₹5000 → RENT marked PARTIAL, LATE_FEE still PENDING ✅
 */
export async function POST(req: Request) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    const body = await req.json();
    let tenantId = body.tenant_id;
    let hostelId = body.hostelId || body.hostel_id;

    // Tenants pay their own dues
    if (user.role === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { profile_id: user.id },
        select: { id: true, hostel_id: true },
      });
      if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);
      tenantId = tenant.id;
      hostelId = tenant.hostel_id;
    }

    // Owners can record payments for their tenants
    if (user.role === "OWNER") {
      if (!tenantId) {
        return apiError("tenant_id is required", "VALIDATION_ERROR", 400);
      }
      if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
      const access = await resolveTenantSettlementAccess(user, { tenantId, hostelId, enforceHostelMatch: true });
      hostelId = access.effectiveHostelId;
    } else if (user.role !== "TENANT") {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }

    const amountPaid = Number(body.amount_paid);
    if (!amountPaid || amountPaid <= 0) {
      return apiError("amount_paid must be a positive number", "VALIDATION_ERROR", 400);
    }

    if (!body.payment_method) {
      return apiError("payment_method is required", "VALIDATION_ERROR", 400);
    }

    const result = await paymentService.recordTenantPayment({
      hostelId,
      tenantId,
      amountPaid,
      paymentMethod: body.payment_method,
      referenceNumber: body.reference_number,
      paymentDate: body.payment_date ? new Date(body.payment_date) : undefined,
      userId: user.id,
      idempotencyKey: body.idempotency_key || undefined,
    });

    // Handle idempotent duplicate
    if ("duplicate" in result) {
      return NextResponse.json({
        message: "Payment already processed (idempotent)",
        ...result,
      });
    }

    // Type-safe: at this point, result is guaranteed to be the success branch
    const txResult = result as { allocations: any[]; totalDue: number; totalPaid: number; remaining: number; overallStatus: string; groupId: string };

    return NextResponse.json({
      message: txResult.overallStatus === "PAID"
        ? "All dues paid successfully"
        : `Partial payment recorded. ₹${txResult.remaining} still outstanding.`,
      payment_group_id: txResult.groupId,
      total_paid: txResult.totalPaid,
      total_due: txResult.totalDue,
      remaining: txResult.remaining,
      overall_status: txResult.overallStatus,
      allocations: txResult.allocations.map((a: any) => ({
        payment_id: a.payment_id,
        obligation_id: a.obligation_id,
        obligation_type: a.obligation_type,
        allocated: a.allocated,
        status: a.new_status,
      })),
    });
  } catch (error: any) {
    console.error("Error recording tenant payment:", error);
    const message = String(error?.message ?? error);
    if (message.includes("HOSTEL_ACCESS_DENIED")) return apiError(message.replace("HOSTEL_ACCESS_DENIED: ", ""), "HOSTEL_ACCESS_DENIED", 403);
    if (message.includes("HOSTEL_CONTEXT_REQUIRED")) return apiError(message.replace("HOSTEL_CONTEXT_REQUIRED: ", ""), "HOSTEL_CONTEXT_REQUIRED", 400);
    if (message.includes("FORBIDDEN")) return apiError(message.replace("FORBIDDEN: ", ""), "FORBIDDEN", 403);
    if (message.includes("NOT_FOUND")) return apiError(message.replace("NOT_FOUND: ", ""), "NOT_FOUND", 404);
    if (message.includes("BAD_REQUEST")) return apiError(message, "VALIDATION_ERROR", 400);
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
