export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { changeManagementFacade } from "@/src/services/change-management/change-management-facade";

/**
 * POST /api/change-requests/[id]/reject
 * Tenant rejects (declines) a pending change request.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized());
  }

  // Only tenants can reject change requests
  if (session.role !== "TENANT") {
    return ApiResponse.error(ApiError.forbidden("Only tenants can decline change requests"));
  }

  try {
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    if (!reason) {
      return ApiResponse.error(ApiError.badRequest("A reason is required when declining a change request"));
    }

    const result = await changeManagementFacade.reject(
      params.id,
      session.sub,
      {
        reason,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined,
        userAgent: req.headers.get("user-agent") || undefined,
      }
    );

    return ApiResponse.success({
      id: result.id,
      status: result.status,
      message: "Change request declined.",
    });
  } catch (error: any) {
    console.error(`[change-requests.${params.id}.reject] Error:`, error);
    return ApiResponse.error(error);
  }
}
