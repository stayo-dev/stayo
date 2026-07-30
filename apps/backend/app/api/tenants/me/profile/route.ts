export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { TenantProfileUpdateSchema } from "@/lib/validators";
import {
  getTenantPortalProfile,
  validateTenantPhones,
} from "@/lib/services/tenant-profile-portal-service";

/**
 * GET /api/tenants/me/profile — Full tenant portal profile (operational + editable fields)
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const data = await getTenantPortalProfile(session.sub);
    if (!data) return apiError("Tenant profile not found", "NOT_FOUND", 404);
    return apiResponse(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return apiError(msg || "Failed to fetch tenant profile");
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Only tenants can update their profile", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const validated = TenantProfileUpdateSchema.safeParse(body);
    if (!validated.success) {
      return apiError(
        `Validation error: ${validated.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
        "VALIDATION_ERROR",
        400
      );
    }

    const phoneErr = validateTenantPhones(validated.data);
    if (phoneErr) return apiError(phoneErr, "VALIDATION_ERROR", 400);

    await tenantService.updateTenantSelfProfile(session.sub, validated.data, session.sub);

    const profileFields = ["city", "state", "pincode"] as const;
    const profilePatch: Record<string, string | null> = {};
    for (const key of profileFields) {
      if (key in body) profilePatch[key] = body[key] ?? null;
    }
    if (Object.keys(profilePatch).length > 0) {
      const { prisma } = await import("@/lib/db");
      await prisma.profile.update({
        where: { id: session.sub },
        data: profilePatch,
      });
    }

    const refreshed = await getTenantPortalProfile(session.sub);
    return apiResponse(refreshed);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg || "Failed to update profile");
  }
}
