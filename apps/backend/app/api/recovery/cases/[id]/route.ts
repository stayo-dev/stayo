export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { recoveryService } from "@/src/services/recovery/recovery-service";
import { prisma } from "@/lib/db";
import "@/src/services/recovery/bootstrap";

/**
 * GET /api/recovery/cases/[id]
 * Case detail including its append-only event trail. hostelId ownership is
 * derived from the case row itself (not a client-supplied query param) and
 * verified against the caller's owner scope.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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

    const events = await prisma.correction_case_events.findMany({
      where: { correction_case_id: params.id },
      orderBy: { created_at: "asc" },
    });

    return ApiResponse.success({ ...kase, events });
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("UNAUTHORIZED")) return ApiResponse.error(ApiError.unauthorized(msg.split(": ")[1] ?? msg));
    return ApiResponse.error(ApiError.internal("Failed to fetch recovery case"));
  }
}
