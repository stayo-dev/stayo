import { NextRequest, NextResponse } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantAnalyticsService } from "@/lib/services/tenant-analytics-service";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const { tenant_id, reason, notes } = body;

    if (!tenant_id || !reason) {
      return apiError("tenant_id and reason are required", "VALIDATION_ERROR", 400);
    }

    // Verify ownership
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenant_id },
      select: { owner_id: true }
    });

    if (!tenant || tenant.owner_id !== session.sub) {
      return apiError("Tenant not found or unauthorized", "NOT_FOUND", 404);
    }

    const result = await tenantAnalyticsService.processExit(tenant_id, reason, notes);
    return apiResponse(result);
  } catch (error: any) {
    if (error.message === "INVALID_EXIT_REASON") {
      return NextResponse.json({ error: "INVALID_EXIT_REASON" }, { status: 400 });
    }
    return apiError(error.message || "Failed to process tenant exit");
  }
}
