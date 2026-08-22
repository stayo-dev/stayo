export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { ownerPayoutReadModel } from "@/src/services/settlements/owner-payout-read-model";

/**
 * GET /api/owner/payouts/summary — the Money tab's payout strip.
 *
 * Returns FACTS, not a headline: what came in today and from whom, what Stayo
 * still holds and by when, whether a transfer failed, and the month block the
 * owner reconciles against his own records. The screen chooses which of those
 * to lead with. Putting the sentence here would make owner-facing copy a
 * backend deploy and would stop the same numbers being usable anywhere else.
 *
 * Owner-scoped: the owner id comes from the session via `resolveOwnerScope`,
 * never from a query parameter. There is no `ownerId` input on this route by
 * design — an admin reading another owner's payouts uses the admin console.
 *
 * The hostel filter is deliberately NOT accepted. A payout is one bank
 * transfer covering every hostel at once; a filtered payout figure would differ
 * from the owner's passbook, which is the one document he trusts more than us.
 * Per-hostel attribution lives inside a payout's breakdown instead.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const summary = await ownerPayoutReadModel.getSummary(scope.owner_id);
    return apiResponse(summary);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to load payouts");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
