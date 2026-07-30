export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { changeManagementFacade } from "@/src/services/change-management/change-management-facade";

/**
 * POST /api/change-requests/[id]/approve
 * Tenant approves a pending change request.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized());
  }

  // Only tenants can approve change requests
  if (session.role !== "TENANT") {
    return ApiResponse.error(ApiError.forbidden("Only tenants can approve change requests"));
  }

  try {
    const body = await req.json().catch(() => ({}));

    const result = await changeManagementFacade.approve(
      params.id,
      session.sub,
      {
        notes: typeof body.notes === "string" ? body.notes : undefined,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined,
        userAgent: req.headers.get("user-agent") || undefined,
      }
    );

    return ApiResponse.success({
      id: result.cr.id,
      status: result.status,
      message: result.status === "APPLIED"
        ? "Changes approved and applied."
        : "Changes approved. Waiting for processing.",
    });
  } catch (error: any) {
    console.error(`[change-requests.${params.id}.approve] Error:`, error);
    return ApiResponse.error(error);
  }
}
