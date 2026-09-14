export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

/**
 * GET /api/tenant/stay — the signed-in tenant's stay: hostel, whether they
 * are a resident, their derived status, and the date window for leave
 * (today, suggested return, min/max). The QR page and Tenant Home render
 * straight from this. See ADR-193.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }
  try {
    return apiResponse(await stayService.getMyStay(session.sub));
  } catch (error) {
    return stayErrorResponse(error);
  }
}
