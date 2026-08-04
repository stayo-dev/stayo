export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertBodySize } from "@/lib/security/api-guard";
import { hostelOrderService, HostelOrderError } from "@/lib/services/hostel-order-service";
import { invalidatePortfolioCache } from "@/lib/cache/dashboard-cache";

/**
 * 🏨 PATCH /api/owner/hostels/reorder
 *
 * Persists the owner's manual ordering of the Home "Property" list.
 * Body: `{ order: ["<hostelId>", "<hostelId>", ...] }` — the full ordered
 * list of the owner's ACTIVE/INACTIVE hostels.
 *
 * Access: Owner/Admin only, owner-scoped. See ADR-042.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));

    const result = await hostelOrderService.reorder(scope.owner_id, body?.order);

    // The Home list reads through the portfolio summary, which is cached.
    // Deliberately the portfolio-scoped helper, not the owner-wide dashboard
    // one — ordering changes nothing about the money metrics.
    invalidatePortfolioCache(scope.owner_id);

    return apiResponse(result);
  } catch (error: any) {
    if (error instanceof HostelOrderError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "STALE_ORDER" ? 409 : 400;
      return apiError(error.message, error.code, status);
    }
    console.error("Detailed API Error [owner.hostels.reorder.PATCH]:", error);
    return apiError(error.message || "Failed to reorder hostels");
  }
}
