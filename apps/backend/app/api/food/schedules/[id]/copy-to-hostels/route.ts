export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { copyScheduleToHostels } from "@/lib/services/food/copy-schedule";

/**
 * POST /api/food/schedules/[id]/copy-to-hostels
 * Body: { targetHostelIds: string[], confirmOverwrite?: boolean }
 *
 * Copies this schedule's full weekly pattern (all 28 cells) into one or more
 * of the owner's other hostels for the same month, resolving/creating
 * matching `food_menu_items` in each target library by name (item ids never
 * carry across hostels — the library is per-hostel). The target's publish
 * state is made to match the source: PUBLISHED source -> target published
 * too (with the usual tenant notification), DRAFT source -> target stays
 * DRAFT.
 *
 * If a target already has real menu content for this month and the caller
 * didn't pass `confirmOverwrite: true`, nothing is written and a 409 lists
 * which hostels would be overwritten — same retry convention as the meals
 * PATCH route's STALE_WRITE.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const targetHostelIds = Array.isArray(body.targetHostelIds) ? body.targetHostelIds : [];
    const confirmOverwrite = body.confirmOverwrite === true;

    const result = await copyScheduleToHostels(id, scope.owner_id, targetHostelIds, confirmOverwrite);

    if ("pendingOverwrite" in result) {
      return apiError(
        "Some hostels already have a menu for this month",
        "CONFIRM_OVERWRITE",
        409,
        { pendingOverwrite: result.pendingOverwrite },
      );
    }

    return apiResponse(result);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to copy schedule");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    if (msg.startsWith("VALIDATION_ERROR")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    return apiError(msg);
  }
}
