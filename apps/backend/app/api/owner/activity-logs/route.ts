export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { hostelActivityFeedService } from "@/lib/services/hostel-activity-feed-service";

/**
 * GET /api/owner/activity-logs?hostelId=<uuid>
 *
 * The per-hostel activity timeline. Event building lives in
 * `hostelActivityFeedService` so the Overview card and the full history
 * screen read the same feed.
 *
 * `include` selects how much work to do:
 *   - `events`  — the timeline only. No balance reconstruction, no
 *                 attention panel. What the Overview card asks for.
 *   - omitted   — everything (timeline + positions + today + attention),
 *                 which is what the full history screen asks for and what
 *                 this route has always returned.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const scope = resolveOwnerScope(session);
  const { searchParams } = new URL(req.url);

  const hostelIdParam = searchParams.get("hostelId") || undefined;
  const isUuid =
    hostelIdParam &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelIdParam);
  const hostelId = isUuid ? hostelIdParam : undefined;

  const categoryFilter = searchParams.get("category") || undefined;
  const search = searchParams.get("search") || undefined;
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "50")));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));

  // Anything other than the explicit lightweight opt-in gets the full
  // payload, so an older caller that passes nothing is unaffected.
  const eventsOnly = (searchParams.get("include") || "").trim() === "events";

  try {
    let activeHostelId: string;
    if (hostelId) {
      activeHostelId = hostelId;
    } else {
      const firstHostel = await prisma.hostels.findFirst({
        where: { owner_id: scope.owner_id, status: { in: ["ACTIVE", "INACTIVE"] } },
        select: { id: true },
      });
      if (!firstHostel) {
        return apiResponse({
          items: [],
          total: 0,
          todaySummary: { payments: 0, expenses: 0, moveouts: 0, pendingActions: 0 },
          needsAttention: {
            overdueTenants: [],
            vacantBeds: { count: 0, rooms: [] },
            pendingDocs: [],
            pendingMoveOuts: [],
          },
        });
      }
      activeHostelId = firstHostel.id;
    }

    const feed = await hostelActivityFeedService.getEvents({
      hostelId: activeHostelId,
      ownerId: scope.owner_id,
      limit,
      offset,
      category: categoryFilter,
      search,
      withPositions: !eventsOnly,
    });

    if (eventsOnly) {
      return apiResponse({ items: feed.items, total: feed.total });
    }

    const needsAttention = await hostelActivityFeedService.getNeedsAttention(activeHostelId);
    const pendingActions =
      needsAttention.overdueTenants.length +
      needsAttention.pendingDocs.length +
      needsAttention.pendingMoveOuts.length;
    const todaySummary = await hostelActivityFeedService.getTodaySummary(
      activeHostelId,
      pendingActions,
    );

    return apiResponse({
      items: feed.items,
      total: feed.total,
      todaySummary,
      needsAttention,
    });
  } catch (error: any) {
    console.error("Failed to query operational activity logs:", error);
    return apiError(error.message || "Failed to fetch activity logs");
  }
}
