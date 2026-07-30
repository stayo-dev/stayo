export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { changeManagementFacade } from "@/src/services/change-management/change-management-facade";

/**
 * POST /api/change-requests/[id]/cancel
 * Owner withdraws a pending change request.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Only owners can cancel change requests"));
  }

  try {
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    const result = await changeManagementFacade.cancel(
      params.id,
      session.owner_id || session.sub,
      reason
    );

    return ApiResponse.success({
      id: result.id,
      status: result.status,
      message: "Change request cancelled.",
    });
  } catch (error: any) {
    console.error(`[change-requests.${params.id}.cancel] Error:`, error);
    return ApiResponse.error(error);
  }
}
