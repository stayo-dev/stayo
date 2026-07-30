export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { authService } from "@/lib/services/auth-service";
import { billingTransitionService } from "@/lib/services/billing-transition-service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    const body = await req.json().catch(() => ({}));
    if (body.action === "APPROVE") {
      const result = await billingTransitionService.approve(params.id, user.id);
      return ApiResponse.success(result);
    }
    if (body.action === "REJECT") {
      const request = await billingTransitionService.reject(params.id, user.id, body.rejection_reason);
      return ApiResponse.success({ request });
    }
    return ApiResponse.error(ApiError.badRequest("action must be APPROVE or REJECT"));
  } catch (error: any) {
    console.error("Owner frequency decision error:", error);
    const message = String(error?.message ?? error);
    if (["REQUEST_NOT_FOUND", "REQUEST_ALREADY_DECIDED", "UNCLEAN_BILLING_PERIOD"].some((code) => message.includes(code))) {
      return ApiResponse.error(ApiError.badRequest(message));
    }
    return ApiResponse.error(ApiError.internal(message));
  }
}
