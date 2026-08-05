export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { collectionQueueService } from "@/lib/services/collection-queue/collection-queue-service";

/**
 * 💰 GET /api/owner/collection-queue?hostelId=<optional>
 *
 * Today's rent-collection work queue, grouped and prioritised. See ADR-045.
 *
 * Returns `{groups:[{id,label,order,count,totalOutstanding,rows:[…]}],
 * totalTenants, totalOutstanding, generatedAt}`. Each row carries `score` plus
 * the `factors` that produced it, so the ordering is explainable in the UI
 * rather than being an opaque number.
 *
 * `hostelId` is **optional here by design** — the queue is a portfolio-wide
 * view of today's work, and forcing a single hostel would make a multi-hostel
 * owner run it once per property. This is not the `hostelId`-required
 * operational pattern; when supplied it is still ownership-checked.
 *
 * Access: Owner/Admin only, owner-scoped.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId") || undefined;

    if (hostelId) {
      await assertHostelBelongsToOwner(scope.owner_id, hostelId);
    }

    // Explicit null = whole portfolio. See the service's `hostelFilter` note.
    const queue = await collectionQueueService.getQueue({
      ownerId: scope.owner_id,
      hostelFilter: hostelId ?? null,
    });
    return apiResponse(queue);
  } catch (error: any) {
    if (String(error?.code) === "FORBIDDEN") {
      return apiError(error.message || "Forbidden", "FORBIDDEN", 403);
    }
    console.error("Detailed API Error [owner.collection-queue.GET]:", error);
    return apiError(error.message || "Failed to build the collection queue");
  }
}
