export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { leadInvitationService } from "@/src/services/platform-leads/lead-invitation-service";

/**
 * POST /api/platform-admin/leads/[id]/resend-invitation
 *
 * Mints a fresh 7-day activation token and re-sends it. Available for both
 * acquisition channels — approveLead only allows a retry while a lead is
 * stuck at APPROVED (a failed send); once a send has succeeded and the lead
 * reached INVITE_SENT, this is the only way to send another link (e.g. the
 * owner lost the message, or the 7-day link expired).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_LEADS");
    const result = await leadInvitationService.resendInvitation(id);
    return apiResponse(result);
  } catch (error: any) {
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    const msg = String(error?.message || "Failed to resend invitation");
    const [maybeCode, ...rest] = msg.split(": ");
    const code = maybeCode?.trim();
    const message = rest.length > 0 ? rest.join(": ").trim() : msg;
    const statusMap: Record<string, number> = {
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      INVALID_TRANSITION: 409,
    };
    return apiError(message, code || "RESEND_FAILED", statusMap[code || ""] || 500);
  }
}
