export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { authService } from "@/lib/services/auth-service";
import { billingTransitionService } from "@/lib/services/billing-transition-service";

export async function GET(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    const { searchParams } = new URL(req.url);
    const requests = await billingTransitionService.listForOwner(user.id, {
      hostelId: searchParams.get("hostelId") || undefined,
      tenantId: searchParams.get("tenantId") || undefined,
      status: searchParams.get("status") || undefined,
    });
    return ApiResponse.success({ requests });
  } catch (error: any) {
    console.error("Owner frequency requests error:", error);
    return ApiResponse.error(ApiError.internal(String(error?.message ?? error)));
  }
}
