export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ServiceRequestType } from "@prisma/client";

const VALID_TYPES: string[] = Object.values(ServiceRequestType);

/**
 * GET /api/tenants/me/service-requests
 * The tenant's own requests, newest first.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const requests = await prisma.tenant_service_requests.findMany({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: "desc" },
      take: 50,
    });

    return apiResponse({ requests });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch service requests");
  }
}

/**
 * POST /api/tenants/me/service-requests
 * Body: { type, category?, description?, photoUrl? }
 * One unified endpoint for all 6 request types (maintenance, room change,
 * cleaning, lost key, visitor pass, extra mattress) — matches the design's
 * own single generic request-form engine.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true, hostel_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const { type, category, description, photoUrl } = body;

    if (!type || !VALID_TYPES.includes(type)) {
      return apiError(`type must be one of: ${VALID_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const request = await prisma.tenant_service_requests.create({
      data: {
        hostel_id: tenant.hostel_id,
        tenant_id: tenant.id,
        type: type as ServiceRequestType,
        category: typeof category === "string" && category.trim() ? category.trim() : null,
        description: typeof description === "string" && description.trim() ? description.trim() : null,
        photo_url: typeof photoUrl === "string" && photoUrl.trim() ? photoUrl.trim() : null,
      },
    });

    await prisma.tenant_service_request_events.create({
      data: { request_id: request.id, status: "RAISED", actor_role: "TENANT" },
    });

    return apiResponse(request, 201);
  } catch (error: any) {
    return apiError(error?.message || "Failed to create service request");
  }
}
