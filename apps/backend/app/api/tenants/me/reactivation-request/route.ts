export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";


/**
 * 👨‍🎓 REQUEST REACTIVATION
 * POST /api/tenants/me/reactivation-request
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Only tenants can request reactivation", "FORBIDDEN", 403);
  }

  try {
    const result = await tenantService.requestReactivation(session.sub, session.sub);
    return apiResponse(result, 201);
  } catch (error: any) {
    if (error.message.startsWith("NOT_FOUND")) return apiError(error.message.split(": ")[1], "NOT_FOUND", 404);
    if (error.message.startsWith("BAD_REQUEST")) return apiError(error.message.split(": ")[1], "VALIDATION_ERROR", 400);
    return apiError(error.message || "Failed to create reactivation request");
  }
}
