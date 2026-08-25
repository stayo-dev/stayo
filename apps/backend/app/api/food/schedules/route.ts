export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const MEAL_TYPES = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;

function firstOfMonth(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/food/schedules?hostelId=&month=YYYY-MM
 * Fetch the (single, mutable) schedule row + its 28 meal cells for a month.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const month = firstOfMonth(searchParams.get("month")) ?? firstOfMonth(new Date().toISOString());

    const schedule = await prisma.food_schedules.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId!, month: month! } },
      include: { food_schedule_meals: { include: { food_schedule_meal_items: { orderBy: { display_order: "asc" } } } } },
    });

    return apiResponse({ schedule });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch schedule");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}

/**
 * POST /api/food/schedules
 * Body: { hostelId, month: "YYYY-MM" }
 *
 * "Ensure exists" — idempotent create of an empty DRAFT schedule for a
 * hostel+month, called the first time the owner opens the Timetable for a
 * month with no schedule row yet. Creates the 28 empty
 * `food_schedule_meals` cells (no items, legacy fields left at their empty
 * default) so there is something for the owner to drop items into — this is
 * a plain structural scaffold, not automatic meal generation: it never picks
 * a dish and never copies content from any other month (see ADR-114).
 *
 * Returns the existing row unchanged (200) if one already exists — safe to
 * call on every page load/month navigation without risk of duplicating the
 * schedule.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const hostelId = typeof body.hostelId === "string" ? body.hostelId : null;
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const month = firstOfMonth(body.month);
    if (!month) return apiError("month must be in YYYY-MM format", "VALIDATION_ERROR", 400);

    const existing = await prisma.food_schedules.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId!, month } },
      include: { food_schedule_meals: { include: { food_schedule_meal_items: { orderBy: { display_order: "asc" } } } } },
    });
    if (existing) return apiResponse({ schedule: existing }, 200);

    const created = await prisma.$transaction(async (tx) => {
      const schedule = await tx.food_schedules.create({
        data: { hostel_id: hostelId!, owner_id: scope.owner_id, month, status: "DRAFT", source: "MANUAL" },
      });
      await tx.food_schedule_meals.createMany({
        data: DAY_ORDER.flatMap((day) =>
          MEAL_TYPES.map((mealType) => ({
            schedule_id: schedule.id,
            day_of_week: day,
            meal_type: mealType,
            menu_item_id: null,
            item_name: "Not set",
          })),
        ),
      });
      return tx.food_schedules.findUnique({
        where: { id: schedule.id },
        include: { food_schedule_meals: { include: { food_schedule_meal_items: { orderBy: { display_order: "asc" } } } } },
      });
    });

    return apiResponse({ schedule: created }, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create schedule");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
