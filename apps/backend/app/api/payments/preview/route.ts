export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    }

    const { searchParams } = new URL(req.url || "");
    const idsParam = searchParams.get("ids");
    if (!idsParam) {
      return ApiResponse.error(ApiError.badRequest("ids query parameter is required"));
    }

    const obligationIds = idsParam.split(",").map(id => id.trim()).filter(Boolean);
    if (obligationIds.length === 0) {
      return ApiResponse.error(ApiError.badRequest("ids must be a non-empty comma-separated list"));
    }

    let tenantId: string | undefined;
    if (user.role === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { profile_id: user.id },
        select: { id: true },
      });
      if (!tenant) {
        return ApiResponse.error(ApiError.notFound("Tenant enrollment not found"));
      }
      tenantId = tenant.id;
    } else if (user.role === "OWNER") {
      const hostelId = searchParams.get("hostelId");
      if (!hostelId) return ApiResponse.error(ApiError.badRequest("hostelId is required"));
      const hostel = await prisma.hostels.findUnique({ where: { id: hostelId }, select: { owner_id: true } });
      if (!hostel || hostel.owner_id !== user.id) return ApiResponse.error(ApiError.forbidden("Forbidden"));
      const count = await prisma.rent_obligations.count({
        where: { id: { in: obligationIds }, owner_id: user.id, hostel_id: hostelId },
      });
      if (count !== obligationIds.length) {
        return ApiResponse.error(ApiError.forbidden("All obligations must belong to the requested hostel"));
      }
    } else {
      return ApiResponse.error(ApiError.forbidden("Forbidden"));
    }

    const preview = await paymentService.previewPaymentAmount(obligationIds, user.id, tenantId);

    const normalized = {
      items: preview.obligations.map((item: any) => ({
        id: item.id,
        tenant_id: item.tenant_id,
        rent_month: item.rent_month,
        type: item.obligation_type,
        due_amount: item.due_amount,
        paid_amount: item.paid_amount,
        outstanding_amount: item.outstanding_amount,
        status: item.status,
      })),
      total_outstanding: preview.total_outstanding,
      currency: preview.currency,
    };

    return ApiResponse.success(normalized);
  } catch (error: any) {
    console.error("Error previewing payment:", error);
    const message = String(error?.message ?? error);
    if (message.includes("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(message.split(": ")[1] ?? message));
    if (message.includes("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(message.split(": ")[1] ?? message));
    if (message.includes("BAD_REQUEST")) return ApiResponse.error(ApiError.badRequest(message.split(": ")[1] ?? message));
    return ApiResponse.error(ApiError.internal(message));
  }
}
