export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { roomAllocationService } from "@/src/services/rooms/room-allocation-service";
import { AllocationSchema } from "@/lib/validators";


export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role === "TENANT") {
    console.warn(`[allocations.GET] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    console.log(`[allocations.GET] Fetching active allocations for owner ${session.sub}`);
    const allocations = await roomAllocationService.getActiveAllocations(session.sub);
    return apiResponse({
      success: true,
      data: allocations
    });
  } catch (error: any) {
    console.error("Detailed API Error [allocations.GET]:", error);
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role === "TENANT") {
    console.warn(`[allocations.POST] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log(`[allocations.POST] Creating allocation for owner ${session.sub}`, body);
    
    const validated = AllocationSchema.safeParse(body);
    if (!validated.success) {
      console.warn(`[allocations.POST] Validation failed for owner ${session.sub}`);
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }

    const { tenant_id, room_id, start_date } = validated.data;

    const allocation = await roomAllocationService.allocateRoom({
      tenantId: tenant_id,
      roomId: room_id,
      startDate: start_date.toISOString(),
      ownerId: session.sub
    });

    console.log(`[allocations.POST] Allocation created: ${allocation.id}`);
    return apiResponse({
      success: true,
      data: allocation
    }, 201);
  } catch (error: any) {
    console.error("Detailed API Error [allocations.POST]:", error);
    
    if (error.message.startsWith("VALIDATION_ERROR")) return apiError(error.message.split(": ")[1], "VALIDATION_ERROR", 400);
    if (error.message.startsWith("NOT_FOUND")) return apiError(error.message.split(": ")[1], "NOT_FOUND", 404);
    if (error.message.startsWith("FORBIDDEN")) return apiError(error.message.split(": ")[1], "FORBIDDEN", 403);
    if (error.message.startsWith("RPC_ERROR")) return apiError(error.message.split(": ")[1], "RPC_ERROR", 500);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
