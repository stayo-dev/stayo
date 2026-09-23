export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { partnerPortalService } from "@/src/services/marketing/partner-portal-service";

/**
 * GET /api/partner/:token — the off-platform owner's view of their listing.
 *
 * Bearer-token, no account: a marketplace partner has no Stayo login, and
 * making them create one to see their own enquiries would put the signup we
 * are trying to earn in front of the value we are trying to prove.
 *
 * The token is a permanent bearer secret, the same trade-off
 * `platform_leads.tracking_token` takes: anyone holding the link sees this
 * partner's enquiries. Accepted because the alternative is an account.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return apiResponse(await partnerPortalService.getPortal(token));
  } catch (error: any) {
    return apiError(error.message || "Invalid link", error.code || "INVALID_TOKEN", error.status || 404);
  }
}
