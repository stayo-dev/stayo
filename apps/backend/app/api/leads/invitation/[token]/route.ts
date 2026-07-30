export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { leadInvitationService } from "@/src/services/platform-leads/lead-invitation-service";

function mapActivationError(error: any) {
  const rawMessage = String(error?.message || "Failed to load activation context");
  const [maybeCode, ...rest] = rawMessage.split(":");
  const code = rest.length ? maybeCode.trim() : "ACTIVATION_ERROR";
  const message = rest.length ? rest.join(":").trim() : rawMessage;
  const statusMap: Record<string, number> = {
    INVALID: 410,
    EXPIRED: 410,
    ALREADY_ACTIVE: 409,
    CANCELLED: 410,
    NOT_FOUND: 404,
    INTERNAL_ERROR: 500,
  };
  return { message, code, status: statusMap[code] || 500 };
}

/**
 * GET /api/leads/invitation/[token] — public, token-gated context for the
 * owner-lead activation landing page. Never looks up by the lead's raw id.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const result = await leadInvitationService.getInvitationContext(token);
    return apiResponse(result);
  } catch (error: any) {
    const mapped = mapActivationError(error);
    return apiError(mapped.message, mapped.code, mapped.status);
  }
}
