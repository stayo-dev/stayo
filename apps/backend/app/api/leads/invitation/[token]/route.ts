export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { leadInvitationService, mapInvitationError } from "@/src/services/platform-leads/lead-invitation-service";

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
    const mapped = mapInvitationError(error);
    return apiError(mapped.message, mapped.code, mapped.status);
  }
}
