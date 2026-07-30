export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { prisma } from "@/lib/db";
import { resolveTenantSettlementAccess } from "@/src/services/payments/tenant-access-guard";

/**
 * 📊 TENANT DUES — Full breakdown of all unpaid obligations (RENT + LATE_FEE)
 *
 * GET /api/payments/tenant-dues?tenant_id=xxx
 *
 * Response:
 * {
 *   tenant_id: "...",
 *   items: [
 *     { obligation_id, type: "RENT", rent_month, amount: 8000, outstanding: 8000, ... },
 *     { obligation_id, type: "LATE_FEE", rent_month, amount: 500, outstanding: 500, ... }
 *   ],
 *   total_due: 8500,
 *   rent_due: 8000,
 *   late_fees_due: 500,
 *   obligation_count: 2
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    }

    const { searchParams } = new URL(req.url);
    let tenantId = searchParams.get("tenant_id");

    // Tenants can only view their own dues
    if (user.role === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { profile_id: user.id },
        select: { id: true },
      });
      if (!tenant) return ApiResponse.error(ApiError.notFound("Tenant not found"));
      tenantId = tenant.id;
    }

    if (!tenantId) {
      return ApiResponse.error(ApiError.badRequest("tenant_id is required"));
    }

    // Owners can only view their own tenants
    if (user.role === "OWNER") {
      await resolveTenantSettlementAccess(user, { tenantId, enforceHostelMatch: false });
    }

    const result = await paymentService.getTenantTotalDues(tenantId);
    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error fetching tenant dues:", error);
    const message = String(error?.message ?? error);
    if (message.includes("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(message.replace("NOT_FOUND: ", "")));
    if (message.includes("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(message.replace("FORBIDDEN: ", "")));
    return ApiResponse.error(ApiError.internal(message));
  }
}
