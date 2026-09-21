export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { partnerClaimService } from "@/src/services/marketing/partner-claim-service";

/**
 * GET — what the partner is about to claim: their hostels, how many
 * enquiries are being held, and which student they came to unlock.
 * Token-gated, no session: they have no account yet, by definition.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return apiResponse(await partnerClaimService.getActivationContext(token));
  } catch (error: any) {
    return apiError(error.message || "Invalid link", error.code || "INVALID_TOKEN", error.status || 404);
  }
}

/**
 * POST — hand the listings to the owner account making this call.
 *
 * Requires a real session, registered in `public-route-exceptions.ts`
 * because it sits under the public `/api/partner` prefix. The account itself
 * is created by the normal owner-signup path first, so there stays exactly
 * one way an owner account comes into being.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession(req);
  try {
    if (!session?.sub) return apiError("Sign in to claim this listing", "UNAUTHORIZED", 401);
    if (session.role !== "OWNER") {
      return apiError("Only an owner account can claim a listing", "FORBIDDEN", 403);
    }
    return apiResponse(await partnerClaimService.claim({ token, ownerId: session.sub }));
  } catch (error: any) {
    return apiError(error.message || "Could not claim", error.code || "ERROR", error.status || 500);
  }
}
