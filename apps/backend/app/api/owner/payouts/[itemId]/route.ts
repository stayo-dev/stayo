export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { ownerPayoutReadModel } from "@/src/services/settlements/owner-payout-read-model";

/**
 * GET /api/owner/payouts/:itemId — which tenants make up one payout.
 *
 * This is the endpoint the whole feature exists for. A payout an owner cannot
 * expand into names is a number Stayo asserts; expanded, it is a claim he can
 * check by phoning someone. `fee: 0` is always present in the response — an
 * unstated zero reads as a fee somebody chose not to mention.
 *
 * A payout belonging to another owner returns 404, not 403 — the two must be
 * indistinguishable, or the route becomes a way to probe for the existence of
 * other owners' payouts.
 */
export async function GET(req: NextRequest, { params }: { params: { itemId: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const breakdown = await ownerPayoutReadModel.getBreakdown(scope.owner_id, params.itemId);
    if (!breakdown) return apiError("Payout not found", "NOT_FOUND", 404);
    return apiResponse(breakdown);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to load payout");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
