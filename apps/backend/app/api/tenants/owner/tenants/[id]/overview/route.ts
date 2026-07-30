export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";


/**
 * 👨‍🎓 OWNER TENANT OVERVIEW
 * GET /api/tenants/owner/tenants/[id]/overview
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const ownerId = session.role === "OWNER" ? resolveOwnerScope(session).owner_id : session.sub;
    const overview = await tenantService.getOwnerTenantOverview(params.id, ownerId);
    return apiResponse(overview);
  } catch (error: any) {
    if (error.message.startsWith("NOT_FOUND")) return apiError(error.message.split(": ")[1], "NOT_FOUND", 404);
    if (error.message.startsWith("FORBIDDEN")) return apiError(error.message.split(": ")[1], "FORBIDDEN", 403);
    return apiError(error.message || "Failed to fetch tenant overview");
  }
}
