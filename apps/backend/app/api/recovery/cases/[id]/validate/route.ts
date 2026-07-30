export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { recoveryService } from "@/src/services/recovery/recovery-service";
import "@/src/services/recovery/bootstrap";

/**
 * POST /api/recovery/cases/[id]/validate
 * Runs policy + dependency checks and, if allowed, transitions the case to
 * VALIDATED. Ownership of the case's own hostelId is verified before anything
 * else — a client can never validate a case belonging to a hostel it doesn't own.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);

    let kase;
    try {
      kase = await recoveryService.getCase(params.id);
    } catch (err: any) {
      if (err?.code === "P2025") {
        return ApiResponse.error(ApiError.notFound("Recovery case not found"));
      }
      throw err;
    }

    await requireHostelBelongsToOwner(scope.owner_id, kase.hostelId);

    const result = await recoveryService.validate(params.id);
    if (!result.allowed) {
      return ApiResponse.error(new ApiError(result.reason || "Case cannot be validated", 422, "VALIDATION_REJECTED"));
    }
    return ApiResponse.success(await recoveryService.getCase(params.id));
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("UNAUTHORIZED")) return ApiResponse.error(ApiError.unauthorized(msg.split(": ")[1] ?? msg));
    return ApiResponse.error(ApiError.internal("Failed to validate recovery case"));
  }
}
