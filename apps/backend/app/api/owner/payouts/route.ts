export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { ownerPayoutReadModel } from "@/src/services/settlements/owner-payout-read-model";

/**
 * GET /api/owner/payouts?q=&limit= — the owner's payout history.
 *
 * `q` matches a UTR/reference, a method, an amount, or a tenant's name, because
 * an owner reconciling reads his bank statement first and the app second: the
 * search has to accept what the statement gives him.
 *
 * Owner-scoped at the SQL level, like the summary route.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? undefined;
    const limitParam = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : undefined;

    const payouts = await ownerPayoutReadModel.listPayouts(scope.owner_id, { q, limit });
    return apiResponse({ payouts });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to load payouts");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
