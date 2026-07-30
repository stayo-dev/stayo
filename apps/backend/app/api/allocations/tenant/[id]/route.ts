export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { roomAllocationService } from "@/src/services/rooms/room-allocation-service";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    return apiError("Authentication required", "UNAUTHORIZED", 401);
  }

  try {
    const tenantId = params.id;
    if (session.role === "OWNER") {
      const ownerId = resolveOwnerScope(session).owner_id;
      const tenant = await prisma.tenants.findFirst({
        where: { id: tenantId, owner_id: ownerId },
        select: { id: true },
      });
      if (!tenant) return apiError("Forbidden", "FORBIDDEN", 403);
    } else if (session.role === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { profile_id: session.sub },
        select: { id: true },
      });
      if (!tenant || tenant.id !== tenantId) return apiError("Forbidden", "FORBIDDEN", 403);
    } else if (session.role !== "ADMIN") {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }
    const history = await roomAllocationService.getTenantHistory(tenantId);
    return apiResponse(history);
  } catch (error: any) {
    console.error("Detailed API Error [allocations.tenant.GET]:", error);
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
