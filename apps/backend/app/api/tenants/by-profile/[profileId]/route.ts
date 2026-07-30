export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";


/**
 * 👨‍🎓 TENANT BY PROFILE ID
 * GET /api/tenants/by-profile/[profileId]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { profileId: string } }
) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const tenant = await tenantService.getTenantByProfile(params.profileId, { sub: session.sub, role: session.role });
    return apiResponse(tenant);
  } catch (error: any) {
    if (error.message.startsWith("NOT_FOUND")) return apiError(error.message.split(": ")[1], "NOT_FOUND", 404);
    if (error.message.startsWith("FORBIDDEN")) return apiError(error.message.split(": ")[1], "FORBIDDEN", 403);
    return apiError(error.message || "Failed to fetch tenant by profile");
  }
}
