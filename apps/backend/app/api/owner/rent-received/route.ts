export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { parseReceivedQuery } from "@/src/services/payments/received-payments-rules";
import { listReceivedPayments } from "@/src/services/payments/received-payments-service";

/**
 * GET /api/owner/rent-received?hostelId=&from=&to=&method=&q=&limit=&offset=
 *
 * Money → Collections → Received: who paid, when, how, and for which months.
 * One row per collection, newest first, with totals for the whole filtered set.
 *
 * Not `/api/owner/payments` — that path is Stayo billing the owner (ADR-224).
 * This is tenants paying the owner.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const query = parseReceivedQuery(req.nextUrl.searchParams);
    // The service already scopes by hostels.owner_id; this turns someone
    // else's hostel id into a clear 403 instead of an empty list.
    if (query.hostelId) await requireHostelBelongsToOwner(scope.owner_id, query.hostelId);
    return apiResponse(await listReceivedPayments(scope.owner_id, query));
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError("Unauthorized", "UNAUTHORIZED", 401);
    console.error("owner.rent-received", error);
    return apiError("Couldn't load received payments");
  }
}
