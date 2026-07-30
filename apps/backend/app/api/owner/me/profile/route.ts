export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { propertyService } from "@/lib/services/property-service";


/**
 * 👤 OWNER PROFILE
 * GET  — Fetch owner profile + hostel + preferences
 * PATCH — Update owner name/phone
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[owner.profile.GET] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    console.log(`[owner.profile.GET] Fetching profile for owner ${session.sub}`);
    const profile = await propertyService.getOwnerProfile(session.sub);
    return apiResponse({
      success: true,
      data: profile
    });
  } catch (error: any) {
    console.error("Detailed API Error [owner.profile.GET]:", error);
    const msg = String(error?.message || "");
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

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[owner.profile.PATCH] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log(`[owner.profile.PATCH] Updating profile for owner ${session.sub}`, body);
    
    const result = await propertyService.updateOwnerProfile(session.sub, body);
    
    console.log(`[owner.profile.PATCH] Profile updated for owner ${session.sub}`);
    return apiResponse({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error("Detailed API Error [owner.profile.PATCH]:", error);
    const msg = String(error?.message || "");
    if (msg.startsWith("VALIDATION"))
      return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
