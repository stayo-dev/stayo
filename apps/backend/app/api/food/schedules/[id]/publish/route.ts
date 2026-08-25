export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";

/**
 * POST /api/food/schedules/[id]/publish
 * DRAFT -> PUBLISHED. No separate "republish" step exists — once published,
 * this same row is what tenants read, so a later edit just updates it in
 * place (see the meals PATCH route). Fans out one in-app notification per
 * active, activated tenant of the hostel.
 *
 * Only blocks when the schedule has zero meal-cell rows at all (shouldn't
 * happen — `POST /api/food/schedules` always creates all 28). Per-cell
 * completeness ("every day/meal filled in") is a client-side gate on the
 * Publish button (see `buildPublishChecks`'s `incompleteCells`, ADR-114) —
 * intentionally not duplicated here, since the button is the only caller.
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

    const schedule = await prisma.food_schedules.findFirst({
      where: { id, owner_id: scope.owner_id },
    });
    if (!schedule) return apiError("Schedule not found", "NOT_FOUND", 404);

    const mealCount = await prisma.food_schedule_meals.count({ where: { schedule_id: id } });
    if (mealCount === 0) {
      return apiError("Generate the schedule before publishing", "VALIDATION_ERROR", 400);
    }

    const wasAlreadyPublished = schedule.status === "PUBLISHED";

    const updated = await prisma.food_schedules.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        published_at: wasAlreadyPublished ? schedule.published_at : new Date(),
        updated_at: new Date(),
      },
    });

    if (!wasAlreadyPublished) {
      const tenants = await prisma.tenants.findMany({
        where: { owner_id: scope.owner_id, hostel_id: schedule.hostel_id, status: "ACTIVE", profile_id: { not: null } },
        select: { profile_id: true },
      });
      await Promise.allSettled(
        tenants
          .filter((t): t is { profile_id: string } => Boolean(t.profile_id))
          .map((t) =>
            notificationService.createNotification(
              t.profile_id,
              "This month's food menu is live",
              "Your hostel owner published the food schedule — check what's cooking this week.",
              "food_schedule_published",
            ),
          ),
      );
    }

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to publish schedule");
  }
}
