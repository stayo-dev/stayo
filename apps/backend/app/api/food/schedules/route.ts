export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertOwnerSubscriptionActive, billingErrorResponse } from "@/src/services/platform-billing/subscription-http";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { ensureMonthSchedule } from "@/lib/services/food/month-carry-forward";

function firstOfMonth(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/food/schedules?hostelId=&month=YYYY-MM
 * Fetch the (single, mutable) schedule row + its 28 meal cells for a month.
 *
 * A month with no menu of its own carries the owner's latest menu forward
 * (`month-carry-forward.ts`), so the owner Home card, Kitchen Sheet and Food
 * page keep showing it after the 1st. Never creates an empty row.
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

    const schedule = await ensureMonthSchedule({
      hostelId: hostelId!,
      ownerId: scope.owner_id,
      month: month!,
      allowCreateEmpty: false,
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
 * "Ensure exists" — called when the owner opens the Meal Plan for a month.
 * If the month has no menu of its own, it inherits the owner's latest menu
 * unchanged (`month-carry-forward.ts`); only when there is no earlier menu at
 * all is an empty 28-cell DRAFT scaffold created. Never picks or ranks a dish
 * — it reuses the week the owner already built (ADR-114, amended 2026-10-10).
 *
 * 200 when the month already had a row (an untouched carried copy is
 * re-synced to the latest menu; an owner-edited month is never touched), 201
 * when one was created. Idempotent — safe on every page load/month navigation.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    await assertOwnerSubscriptionActive(scope.owner_id, "food.schedules");
    const body = await req.json().catch(() => ({}));
    const hostelId = typeof body.hostelId === "string" ? body.hostelId : null;
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const month = firstOfMonth(body.month);
    if (!month) return apiError("month must be in YYYY-MM format", "VALIDATION_ERROR", 400);

    const existed = await prisma.food_schedules.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId!, month } },
      select: { id: true },
    });
    const schedule = await ensureMonthSchedule({
      hostelId: hostelId!,
      ownerId: scope.owner_id,
      month,
      allowCreateEmpty: true,
    });

    return apiResponse({ schedule }, existed ? 200 : 201);
  } catch (error: any) {
    const billing = billingErrorResponse(error);
    if (billing) return billing;
    const msg = String(error?.message || "Failed to create schedule");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
