export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { authService } from "@/lib/services/auth-service";
import { apiError, apiResponse } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { financialTimelineService } from "@/src/services/payments/financial";

/**
 * GET /api/payments/obligations/:id/history
 *
 * Returns the complete event timeline for an obligation.
 * Events are returned in chronological order (oldest first).
 *
 * Auth: OWNER, ADMIN, or the TENANT who owns the obligation.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    // Verify the obligation exists and belongs to the user
    const obligation = await prisma.rent_obligations.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        owner_id: true,
        tenant_id: true,
        tenants: {
          select: { profile_id: true },
        },
      },
    });

    if (!obligation) {
      return apiError("Obligation not found", "NOT_FOUND", 404);
    }

    // Authorization
    const isOwnerOrAdmin = ["OWNER", "ADMIN"].includes(user.role);
    const isTenant = user.role === "TENANT";

    if (isOwnerOrAdmin) {
      const effectiveOwnerId = user.owner_id || user.id;
      if (obligation.owner_id !== effectiveOwnerId) {
        return apiError("Obligation does not belong to you", "FORBIDDEN", 403);
      }
    } else if (isTenant) {
      if (obligation.tenants?.profile_id !== user.id) {
        return apiError("You can only view your own obligation history", "FORBIDDEN", 403);
      }
    } else {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    const events = await financialTimelineService.getObligationTimeline(params.id);

    return apiResponse({
      obligation_id: params.id,
      events,
      total: events.length,
    });
  } catch (error: any) {
    console.error("Error fetching obligation history:", error);
    const message = String(error?.message ?? error);
    if (message.includes("NOT_FOUND")) return apiError(message, "NOT_FOUND", 404);
    return apiError("Internal error fetching obligation history", "INTERNAL_ERROR", 500);
  }
}
