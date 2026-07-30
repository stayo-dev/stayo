export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { propertyService } from "@/lib/services/property-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";


/**
 * 🏠 ROOM OVERVIEW — Get
 * GET /api/rooms/[id]/overview
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[rooms.id.overview.GET] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    console.log(`[rooms.id.overview.GET] Fetching overview for room ${params.id} for owner ${scope.owner_id}`);
    
    const overview = await propertyService.getRoomOverview(params.id, scope.owner_id);
    
    return apiResponse({
      success: true,
      data: overview
    });
  } catch (error: any) {
    console.error(`Detailed API Error [rooms.id.overview.GET] (${params.id}):`, error);
    const msg = typeof error === 'string' ? error : error?.message ?? String(error);
    
    if (msg.startsWith("NOT_FOUND"))
      return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
