export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";


/**
 * GET /api/profiles/unassigned/tenants
 * Returns tenant profiles that are not currently allocated to an active room.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const hostelId = req.nextUrl.searchParams.get("hostelId") || undefined;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const tenants = await prisma.tenants.findMany({
      where: {
        owner_id: scope.owner_id,
        hostel_id: hostelId,
        status: "ACTIVE",
        room_allocations: {
          none: {
            is_active: true,
            end_date: null,
          },
        },
      },
      select: {
        id: true,
        profile_id: true,
        status: true,
        phone_1: true,
        personal_email: true,
        profiles: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const profiles = tenants.map((tenant) => ({
      id: tenant.profile_id ?? tenant.id,
      profile_id: tenant.profile_id,
      tenant_id: tenant.id,
      name: tenant.profiles?.name ?? "Tenant",
      email: tenant.profiles?.email ?? tenant.personal_email ?? null,
      phone: tenant.profiles?.phone ?? tenant.phone_1 ?? null,
      status: tenant.status,
    }));

    return apiResponse({ profiles });
  } catch (error: any) {
    const message = String(error?.message || "Failed to fetch unassigned tenants");
    const code = String(error?.code || "").toUpperCase();
    if (code === "HOSTEL_CONTEXT_REQUIRED" || message.startsWith("HOSTEL_CONTEXT_REQUIRED")) {
      return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
    }
    if (code === "FORBIDDEN" || message.startsWith("FORBIDDEN")) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }
    console.error("[profiles.unassigned.tenants] failed", { code: error?.code, message });
    return apiError(message, "ERROR", 500);
  }
}
