export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { roomAllocationService } from "@/src/services/rooms/room-allocation-service";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role === "TENANT") return apiError("Forbidden", "FORBIDDEN", 403);

  try {
    const { id: allocationId } = params;
    const body = await req.json();
    const endDate = body.end_date || new Date().toISOString();

    // Verify ownership
    const allocation = await prisma.roomAllocation.findUnique({
      where: { id: allocationId },
      include: { tenant: true }
    });

    if (!allocation) {
      return apiError("Allocation not found", "NOT_FOUND", 404);
    }

    if (allocation.tenant.owner_id !== session.sub) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }

    const updated = await roomAllocationService.endAllocation(allocationId, endDate, session.sub);
    
    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error.message || "Failed to end allocation");
  }
}
