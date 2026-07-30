export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutService } from "@/lib/services/move-out-service";

/**
 * GET /api/move-out/requests/[id] — Get move-out request detail with settlement preview
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const request = await moveOutService.getRequestById(params.id);

    // Authorization: tenant can only view own, owner can view own tenants
    if (session.role === "TENANT") {
      if (request.tenant.profile_id !== session.sub) {
        return apiError("Forbidden", "FORBIDDEN", 403);
      }
    } else if (session.role === "OWNER") {
      if (request.owner_id !== session.sub) {
        return apiError("Forbidden", "FORBIDDEN", 403);
      }
    }

    // Include settlement preview if not yet settled
    let preview = null;
    if (!["COMPLETED", "REJECTED"].includes(request.status)) {
      try {
        preview = await moveOutService.calculateSettlementPreview(params.id);
      } catch { /* preview may fail if data missing — ok */ }
    }

    return apiResponse({ ...request, settlement_preview: preview });
  } catch (error: any) {
    const msg = error.message || "Failed to fetch move-out request";
    if (msg.startsWith("NOT_FOUND:")) return apiError(msg, "NOT_FOUND", 404);
    return apiError(msg);
  }
}
