export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { normalizeMealTimings, sanitizeMealTimingsPayload } from "@/lib/services/food/meal-timings";

function toApiError(error: any) {
  const msg = String(error?.message || "Failed to update meal timings");
  if (msg.startsWith("VALIDATION")) return apiError(msg.split(":")[1]?.trim() || msg, "VALIDATION_ERROR", 400);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
  return apiError(msg, "ERROR", 500);
}

/**
 * GET /api/hostels/[id]/meal-timings
 *
 * The hostel's configured serving windows — permanent config, distinct from
 * the changing weekly menu. Never blank for an unconfigured hostel: falls
 * back to `DEFAULT_MEAL_TIMINGS` so every reader (this screen, the weekly
 * grid header, the tenant Food/Home pages) always has something to render.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }
  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    await assertHostelBelongsToOwner(scope.owner_id, id);

    const hostel = await prisma.hostels.findUnique({
      where: { id },
      select: { preferences_config: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    return apiResponse({ meal_timings: normalizeMealTimings(hostel.preferences_config) });
  } catch (error: any) {
    return toApiError(error);
  }
}

/**
 * PATCH /api/hostels/[id]/meal-timings
 * Body: { meal_timings: Partial<MealTimings> } — patches only the meal
 * types present in the body; anything omitted keeps its current value.
 *
 * Read-modify-write on the whole `preferences_config` blob, not an
 * overwrite: that column also carries billing/receipts/branding/tenant-rule
 * settings (see `hostel-billing-preferences-service.ts`), so writing only
 * `{ meal_timings }` would silently drop every other key.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }
  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    await assertHostelBelongsToOwner(scope.owner_id, id);

    const hostel = await prisma.hostels.findUnique({
      where: { id },
      select: { id: true, owner_id: true, status: true, preferences_config: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);
    if (hostel.status === "ARCHIVED") {
      return apiError("Cannot perform operational actions on an archived hostel", "FORBIDDEN", 403);
    }
    if (hostel.status === "INACTIVE") {
      return apiError("Cannot perform operational actions on an inactive hostel", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({}));
    const patch = sanitizeMealTimingsPayload(body?.meal_timings ?? body);

    const existingConfig =
      hostel.preferences_config && typeof hostel.preferences_config === "object" && !Array.isArray(hostel.preferences_config)
        ? (hostel.preferences_config as Record<string, any>)
        : {};
    const nextMealTimings = { ...normalizeMealTimings(existingConfig), ...patch };
    const preferences_config = { ...existingConfig, meal_timings: nextMealTimings };

    await prisma.hostels.update({ where: { id }, data: { preferences_config } });

    await eventLog.log("MEAL_TIMINGS_UPDATED", hostel.owner_id!, {
      hostel_id: id,
      meal_timings: nextMealTimings,
    });

    return apiResponse({ meal_timings: nextMealTimings });
  } catch (error: any) {
    return toApiError(error);
  }
}
