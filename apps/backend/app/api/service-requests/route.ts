export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";

/**
 * GET /api/service-requests?hostelId=&status=
 * Owner queue of tenant service requests for a hostel.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");
    const status = searchParams.get("status") || undefined;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const requests = await prisma.tenant_service_requests.findMany({
      where: {
        hostel_id: hostelId!,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        tenants: { select: { id: true, profiles: { select: { name: true } } } },
      },
      orderBy: { created_at: "desc" },
      take: 100,
    });

    return apiResponse({ requests });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch service requests");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
