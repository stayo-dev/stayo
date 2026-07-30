export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { renewalWorkspaceReadModelService } from "@/src/services/tenants/renewal-workspace-read-model";

/**
 * 🗂️ INDIVIDUAL RENEWAL WORKSPACE
 * GET /api/agreements/renewals/[agreementId]
 *
 * Everything about one renewal in one fetch: current agreement, successor
 * draft (if any), full offer history, timeline, financial summary,
 * documents, and activation readiness.
 */
export async function GET(req: NextRequest, { params }: { params: { agreementId: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const ownerId = session.role === "OWNER" ? resolveOwnerScope(session).owner_id : session.sub;
    const workspace = await renewalWorkspaceReadModelService.getWorkspace(params.agreementId, ownerId);
    return apiResponse(workspace);
  } catch (error: any) {
    if (error.message?.startsWith("NOT_FOUND")) return apiError(error.message.split(": ")[1], "NOT_FOUND", 404);
    if (error.message?.startsWith("FORBIDDEN")) return apiError(error.message.split(": ")[1], "FORBIDDEN", 403);
    return apiError(error.message || "Failed to fetch renewal workspace");
  }
}
