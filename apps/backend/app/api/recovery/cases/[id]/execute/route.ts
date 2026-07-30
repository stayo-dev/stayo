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
 * POST /api/recovery/cases/[id]/execute
 * Executes a VALIDATED case (or retries a previously FAILED one, up to the
 * service's internal retry cap). Ownership of the case's own hostelId is
 * verified before execution.
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

    const result = await recoveryService.execute(params.id, { actorId: scope.actor_id, actorRole: "OWNER" });
    return ApiResponse.success(result);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("UNAUTHORIZED")) return ApiResponse.error(ApiError.unauthorized(msg.split(": ")[1] ?? msg));
    if (msg.includes("is not executable from status") || msg.includes("exceeded maximum retry attempts") || msg.includes("unmet dependency")) {
      return ApiResponse.error(ApiError.conflict(msg));
    }
    return ApiResponse.error(ApiError.internal("Failed to execute recovery case"));
  }
}
