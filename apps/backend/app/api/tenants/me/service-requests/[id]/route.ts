export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/tenants/me/service-requests/[id]
 * Detail + timeline for one of the tenant's own requests.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const request = await prisma.tenant_service_requests.findFirst({
      where: { id, tenant_id: tenant.id },
      include: { tenant_service_request_events: { orderBy: { created_at: "asc" } } },
    });
    if (!request) return apiError("Request not found", "NOT_FOUND", 404);

    return apiResponse(request);
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch service request");
  }
}
