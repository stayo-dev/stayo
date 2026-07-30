export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { authService } from "@/lib/services/auth-service";
import { billingTimelineService } from "@/lib/services/billing-timeline-service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    const timeline = await billingTimelineService.getTenantTimeline(params.id, user.role === "OWNER" ? user.id : undefined);
    return ApiResponse.success(timeline);
  } catch (error: any) {
    console.error("Owner tenant billing timeline error:", error);
    const message = String(error?.message ?? error);
    if (message.includes("TENANT_NOT_FOUND")) return ApiResponse.error(ApiError.notFound("Tenant not found"));
    return ApiResponse.error(ApiError.internal(message));
  }
}
