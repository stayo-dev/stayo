export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutService } from "@/lib/services/move-out-service";

/**
 * GET /api/move-out/tenant — Get active move-out request for current tenant
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const result = await moveOutService.getRequestForTenant(session.sub);
    return apiResponse(result || null);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch move-out status");
  }
}
