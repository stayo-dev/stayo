export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const scope = resolveOwnerScope(session);
    const hostel = await prisma.hostels.findFirst({
      where: { id: params.id, owner_id: scope.owner_id },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        upi_id: true,
        gst_number: true,
        logo_url: true,
        status: true,
        is_active: true,
      },
    });

    if (!hostel) {
      return apiError("Hostel not found", "NOT_FOUND", 404);
    }

    return apiResponse({
      success: true,
      hostel
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch hostel");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    console.warn("[hostels.id.PATCH] Unauthorized access attempt");
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    
    console.log(`[hostels.id.PATCH] Updating hostel ${params.id} for owner ${scope.owner_id}`, body);

    const { propertyService } = await import("@/lib/services/property-service");
    
    // Call propertyService to execute all transition rules & validations
    await propertyService.updateHostel(scope.owner_id, {
      hostel_id: params.id,
      ...body,
    });

    const hostel = await prisma.hostels.findFirst({
      where: { id: params.id, owner_id: scope.owner_id },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        upi_id: true,
        gst_number: true,
        logo_url: true,
        status: true,
        is_active: true,
      },
    });

    // Lifecycle events (HOSTEL_ARCHIVED, HOSTEL_ACTIVATED, etc.) are logged
    // by PropertyService. Only log settings-level changes here.
    const nonStatusFields = Object.keys(body).filter(k => k !== "status" && k !== "archive_reason");
    if (nonStatusFields.length > 0) {
      await eventLog.log("HOSTEL_SETTINGS_UPDATED", scope.owner_id, {
        hostel_id: params.id,
        changed_fields: nonStatusFields,
      });
    }

    console.log(`[hostels.id.PATCH] Hostel ${params.id} updated successfully`);
    return apiResponse({
      success: true,
      hostel
    });
  } catch (error: any) {
    console.error(`Detailed API Error [hostels.id.PATCH] (${params.id}):`, error);
    const msg = String(error?.message || "Failed to update hostel");
    
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(":")[1]?.trim() || msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    console.warn("[hostels.id.DELETE] Unauthorized access attempt");
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { propertyService } = await import("@/lib/services/property-service");

    // Accept optional archive_reason from request body
    const body = await req.json().catch(() => ({}));

    console.log(`[hostels.id.DELETE] Archiving hostel ${params.id} for owner ${scope.owner_id}`);

    await propertyService.updateHostel(scope.owner_id, {
      hostel_id: params.id,
      status: "ARCHIVED",
      archive_reason: body.reason || body.archive_reason || null,
    });

    // Lifecycle event logging is handled centrally by PropertyService

    return apiResponse({
      success: true,
      message: "Hostel archived successfully",
    });
  } catch (error: any) {
    console.error(`Detailed API Error [hostels.id.DELETE] (${params.id}):`, error);
    const msg = String(error?.message || "Failed to archive hostel");
    
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(":")[1]?.trim() || msg, "VALIDATION_ERROR", 400);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
