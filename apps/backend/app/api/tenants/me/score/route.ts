export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { tenantScoreService } from "@/src/services/tenants/tenant-score-service";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Only tenants can access tenant score", "FORBIDDEN", 403);
  }

  try {
    const summary = await tenantScoreService.getTenantScoreSummary(session.sub);
    return apiResponse(summary);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch tenant score");
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] || "Tenant record not found", "NOT_FOUND", 404);
    return apiError(msg);
  }
}

