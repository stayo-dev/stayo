export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { searchService, MIN_QUERY_LENGTH } from "@/lib/services/search/search-service";

/**
 * 🔎 GET /api/owner/search?q=...&limit=8
 *
 * Universal owner search — tenants, hostels and rooms in one grouped
 * response. See ADR-044.
 *
 * This route is deliberately thin and **type-agnostic**: it never mentions
 * tenants, hostels or rooms. Sources are registered in
 * `lib/services/search/search-service.ts`; adding payments, complaints or
 * staff later must not require editing this file.
 *
 * Replaces a previous implementation of the same path that searched only
 * tenant profiles, had no ranking, returned a bare array outside the standard
 * envelope, and was **orphaned** — its client wrapper
 * (`ownerService.searchTenants`) existed but nothing in the app called it.
 *
 * Access: Owner/Admin only, owner-scoped by every provider.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();

    const rawLimit = Number(searchParams.get("limit"));
    const limitPerGroup = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 8;

    // A short query is answered, not rejected — the client shows its "keep
    // typing" state from an empty result rather than having to special-case
    // an error response.
    if (q.length < MIN_QUERY_LENGTH) {
      return apiResponse({ query: q, groups: [], total: 0 });
    }

    const result = await searchService.search({ ownerId: scope.owner_id, query: q, limitPerGroup });
    return apiResponse(result);
  } catch (error: any) {
    console.error("Detailed API Error [owner.search.GET]:", error);
    return apiError(error.message || "Search failed");
  }
}
