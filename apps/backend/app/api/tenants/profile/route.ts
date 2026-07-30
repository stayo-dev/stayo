export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { TenantProfileUpdateSchema } from "@/lib/validators";


export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const tenant = await tenantService.getTenantByProfile(session.sub, {
      sub: session.sub,
      role: session.role
    });
    return apiResponse(tenant);
  } catch (error: any) {
    if (error.message.startsWith("NOT_FOUND")) return apiError(error.message.split(": ")[1], "NOT_FOUND", 404);
    return apiError("Internal server error");
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") return apiError("Only tenants can update their profile self", "FORBIDDEN", 403);

  try {
    const body = await req.json();
    const validated = TenantProfileUpdateSchema.safeParse(body);
    
    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }

    const updated = await tenantService.updateTenantSelfProfile(session.sub, validated.data, session.sub);
    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error.message || "Failed to update profile");
  }
}
