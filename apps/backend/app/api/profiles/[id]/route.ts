export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { userService } from "@/lib/services/user-service";


/**
 * 👤 PROFILE BY ID
 * GET /api/profiles/[id] — Fetch a profile by its ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    // Permission check: Tenants can only see their own profile.
    // Owners/Admins can see any profile.
    if (session.role === "TENANT" && session.sub !== params.id) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }

    const profile = await userService.getProfile(params.id);
    if (!profile) return apiError("Profile not found", "NOT_FOUND", 404);

    return apiResponse(profile);
  } catch (error: any) {
    const msg = String(error?.message || "");
    return apiError(msg || "Failed to fetch profile");
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    // Permission check: Tenants can only update their own profile.
    // Owners/Admins can update any profile.
    if (session.role === "TENANT" && session.sub !== params.id) {
       return apiError("Forbidden", "FORBIDDEN", 403);
    }

    const body = await req.json();
    const result = await userService.updateProfile(params.id, body);
    return apiResponse(result);
  } catch (error: any) {
    const msg = String(error?.message || "");
    return apiError(msg || "Failed to update profile");
  }
}
