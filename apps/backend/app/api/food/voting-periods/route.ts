export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";

function firstOfMonth(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/food/voting-periods?hostelId=&month=YYYY-MM
 * Fetch the voting period for a given hostel+month (or the current month if omitted).
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

    const period = await prisma.food_voting_periods.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId!, month: month! } },
    });

    return apiResponse({ votingPeriod: period });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch voting period");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}

/**
 * POST /api/food/voting-periods
 * Open (or re-schedule) a voting round for a month.
 * Body: { hostelId, month: "YYYY-MM", votingStartsAt, votingEndsAt }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, month: monthStr, votingStartsAt, votingEndsAt } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const month = firstOfMonth(monthStr);
    if (!month) return apiError("month is required (YYYY-MM)", "VALIDATION_ERROR", 400);

    const startsAt = new Date(votingStartsAt);
    const endsAt = new Date(votingEndsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return apiError("votingStartsAt and votingEndsAt must be valid dates", "VALIDATION_ERROR", 400);
    }
    if (endsAt <= startsAt) {
      return apiError("votingEndsAt must be after votingStartsAt", "VALIDATION_ERROR", 400);
    }

    const existing = await prisma.food_voting_periods.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId, month } },
      select: { status: true },
    });

    const period = await prisma.food_voting_periods.upsert({
      where: { hostel_id_month: { hostel_id: hostelId, month } },
      create: {
        hostel_id: hostelId,
        owner_id: scope.owner_id,
        month,
        voting_starts_at: startsAt,
        voting_ends_at: endsAt,
        status: "OPEN",
      },
      update: {
        voting_starts_at: startsAt,
        voting_ends_at: endsAt,
        status: "OPEN",
        updated_at: new Date(),
      },
    });

    // Only announce a genuinely new round. This route is an upsert, so it is
    // also how the owner edits an open window — re-notifying on every date
    // tweak would train tenants to ignore it.
    const isNewRound = !existing || existing.status !== "OPEN";
    let notifiedCount = 0;
    if (isNewRound) {
      const tenants = await prisma.tenants.findMany({
        where: { owner_id: scope.owner_id, hostel_id: hostelId, status: "ACTIVE", profile_id: { not: null } },
        select: { profile_id: true },
      });
      notifiedCount = tenants.length;
      await Promise.allSettled(
        tenants
          .filter((t: { profile_id: string | null }): t is { profile_id: string } => Boolean(t.profile_id))
          .map((t: { profile_id: string }) =>
            notificationService.createNotification(
              t.profile_id,
              // "this month", not "next": the owner opens voting for the month
              // currently being planned, which `FoodPage` passes as the current
              // month. The tenant Food tab was corrected to the same wording on
              // 2026-08-05 for the same reason — see the meals-PATCH note in [[Food]].
              "Vote on this month's menu",
              "Your hostel owner opened food voting — pick what you'd like to eat.",
              "food_voting_opened",
            ),
          ),
      );
    }

    return apiResponse({ ...period, notified: isNewRound ? notifiedCount : 0 }, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to open voting");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
