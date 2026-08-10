export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { ServiceRequestType } from "@prisma/client";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const { type, description } = body;

    if (!type || !Object.values(ServiceRequestType).includes(type)) {
      return apiError("Invalid or missing request type", "VALIDATION_ERROR", 400);
    }

    const tenant = await prisma.tenants.findFirst({
      where: {
        profile_id: session.sub,
        status: "ACTIVE",
      },
      select: { id: true, hostel_id: true },
    });

    if (!tenant) {
      return apiError("Active tenant not found", "TENANT_NOT_FOUND", 404);
    }

    const request = await prisma.tenant_service_requests.create({
      data: {
        hostel_id: tenant.hostel_id,
        tenant_id: tenant.id,
        type: type as ServiceRequestType,
        description: description || null,
        status: "RAISED",
      },
    });

    return apiResponse({ success: true, request });
  } catch (error: any) {
    return apiError(error.message || "Failed to create service request");
  }
}
