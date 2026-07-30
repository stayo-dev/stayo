export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { userService } from "@/lib/services/user-service";
import { TenantProfileUpdateSchema } from "@/lib/validators";


export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const profile = await userService.getProfile(session.sub);
    if (!profile) return apiError("Profile not found", "NOT_FOUND", 404);
    
    return apiResponse(profile);
  } catch (error) {
    return apiError("Failed to fetch profile");
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const body = await req.json();
    const validated = TenantProfileUpdateSchema.safeParse(body);

    if (!validated.success) {
      return apiError("Validation failed", "VALIDATION_ERROR", 400);
    }

    const updated = await userService.updateProfile(session.sub, validated.data);
    return apiResponse(updated);
  } catch (error) {
    return apiError("Failed to update profile");
  }
}
