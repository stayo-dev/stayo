export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { authService } from "@/lib/services/auth-service";
import { prisma } from "@/lib/db";
import { billingTimelineService } from "@/lib/services/billing-timeline-service";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

export async function GET(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || user.role !== "TENANT") return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    const tenant = await prisma.tenants.findFirst({ where: liveTenancyWhere(user.id), select: { id: true } });
    if (!tenant) return ApiResponse.error(ApiError.notFound("Tenant not found"));
    const timeline = await billingTimelineService.getTenantTimeline(tenant.id);
    return ApiResponse.success(timeline);
  } catch (error: any) {
    console.error("Tenant billing timeline error:", error);
    return ApiResponse.error(ApiError.internal(String(error?.message ?? error)));
  }
}
