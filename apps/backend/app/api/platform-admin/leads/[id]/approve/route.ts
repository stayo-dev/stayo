export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { leadInvitationService } from "@/src/services/platform-leads/lead-invitation-service";

/**
 * POST /api/platform-admin/leads/[id]/approve
 * Replaces the old bare-status-PATCH "Approve" action: generates a
 * single-use activation token, sends it (WhatsApp, email fallback), logs
 * every step, and advances status to INVITE_SENT only on a successful
 * send. See lead-invitation-service.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_LEADS");
    const result = await leadInvitationService.approveLead(id);
    return apiResponse(result);
  } catch (error: any) {
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    const msg = String(error?.message || "Failed to approve lead");
    const [maybeCode, ...rest] = msg.split(": ");
    const code = maybeCode?.trim();
    const message = rest.length > 0 ? rest.join(": ").trim() : msg;
    const statusMap: Record<string, number> = {
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      INVALID_TRANSITION: 409,
    };
    return apiError(message, code || "APPROVE_FAILED", statusMap[code || ""] || 500);
  }
}
