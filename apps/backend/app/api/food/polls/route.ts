export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";
import { FoodMealType, FoodPollType, FoodPollStatus } from "@prisma/client";

const VALID_MEAL_TYPES: string[] = Object.values(FoodMealType);
const VALID_POLL_TYPES: string[] = Object.values(FoodPollType);

/**
 * GET /api/food/polls?hostelId=&status=
 * Ad-hoc polls for one hostel, each with its option tallies. Independent of
 * food_voting_periods/food_votes (dormant, decoupled from schedule
 * generation — see ADR-056/ADR-057).
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
    const status = searchParams.get("status");
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    if (status && !["OPEN", "CLOSED"].includes(status)) {
      return apiError("status must be OPEN or CLOSED", "VALIDATION_ERROR", 400);
    }

    const polls = await prisma.food_polls.findMany({
      where: { hostel_id: hostelId!, owner_id: scope.owner_id, ...(status ? { status: status as FoodPollStatus } : {}) },
      orderBy: { created_at: "desc" },
      include: { food_poll_options: { orderBy: { position: "asc" } } },
    });

    const pollIds = polls.map((p) => p.id);
    const tally = pollIds.length
      ? await prisma.food_poll_votes.groupBy({ by: ["poll_id", "option_id"], where: { poll_id: { in: pollIds } }, _count: { _all: true } })
      : [];
    const votersByPoll = pollIds.length
      ? await prisma.food_poll_votes.findMany({ where: { poll_id: { in: pollIds } }, select: { poll_id: true, tenant_id: true }, distinct: ["poll_id", "tenant_id"] })
      : [];
    const eligibleCount = await prisma.tenants.count({ where: { hostel_id: hostelId!, status: "ACTIVE", profile_id: { not: null } } });

    const voterCountByPoll = new Map<string, number>();
    for (const v of votersByPoll) voterCountByPoll.set(v.poll_id, (voterCountByPoll.get(v.poll_id) ?? 0) + 1);
    const countByOption = new Map<string, number>();
    for (const t of tally) countByOption.set(t.option_id, t._count._all);

    const result = polls.map((poll) => {
      const options = poll.food_poll_options.map((o) => ({ id: o.id, label: o.label, position: o.position, votes: countByOption.get(o.id) ?? 0 }));
      const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
      return {
        id: poll.id,
        title: poll.title,
        poll_type: poll.poll_type,
        meal_type: poll.meal_type,
        poll_date: poll.poll_date,
        closes_at: poll.closes_at,
        is_anonymous: poll.is_anonymous,
        allow_multiple: poll.allow_multiple,
        status: poll.status,
        closed_at: poll.closed_at,
        created_at: poll.created_at,
        options,
        totalVotes,
        voterCount: voterCountByPoll.get(poll.id) ?? 0,
        eligibleCount,
      };
    });

    return apiResponse({ polls: result });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch polls");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}

/**
 * POST /api/food/polls
 * Create + publish a poll in one step — no draft state. `RATING`/`YES_NO`
 * polls still take an `options` array; the frontend resolves their fixed
 * labels ("Yes"/"No", "5 stars".."1 star") before sending, so this route
 * doesn't special-case poll type when writing options.
 * Body: { hostelId, title, pollType, mealType, pollDate, closesAt, isAnonymous, allowMultiple, options: string[], notifyNow }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, title, pollType, mealType, pollDate, closesAt, isAnonymous, allowMultiple, options, notifyNow } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    if (!title || typeof title !== "string" || !title.trim()) {
      return apiError("title is required", "VALIDATION_ERROR", 400);
    }
    if (!pollType || !VALID_POLL_TYPES.includes(pollType)) {
      return apiError(`pollType must be one of: ${VALID_POLL_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    if (!mealType || !VALID_MEAL_TYPES.includes(mealType)) {
      return apiError(`mealType must be one of: ${VALID_MEAL_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    const pollDateValue = pollDate ? new Date(`${pollDate}T00:00:00.000Z`) : null;
    if (!pollDateValue || Number.isNaN(pollDateValue.getTime())) {
      return apiError("pollDate must be a valid date (YYYY-MM-DD)", "VALIDATION_ERROR", 400);
    }
    const closesAtValue = closesAt ? new Date(closesAt) : null;
    if (!closesAtValue || Number.isNaN(closesAtValue.getTime())) {
      return apiError("closesAt must be a valid date/time", "VALIDATION_ERROR", 400);
    }
    if (closesAtValue <= new Date()) {
      return apiError("closesAt must be in the future", "VALIDATION_ERROR", 400);
    }
    const cleanOptions: string[] = Array.isArray(options) ? options.map((o: unknown) => String(o).trim()).filter(Boolean) : [];
    if (cleanOptions.length < 2) {
      return apiError("At least 2 options are required", "VALIDATION_ERROR", 400);
    }

    const poll = await prisma.$transaction(async (tx) => {
      const created = await tx.food_polls.create({
        data: {
          hostel_id: hostelId,
          owner_id: scope.owner_id,
          title: title.trim(),
          poll_type: pollType as FoodPollType,
          meal_type: mealType as FoodMealType,
          poll_date: pollDateValue,
          closes_at: closesAtValue,
          is_anonymous: Boolean(isAnonymous),
          allow_multiple: Boolean(allowMultiple),
        },
      });
      await tx.food_poll_options.createMany({
        data: cleanOptions.map((label, position) => ({ poll_id: created.id, label, position })),
      });
      return tx.food_polls.findUnique({
        where: { id: created.id },
        include: { food_poll_options: { orderBy: { position: "asc" } } },
      });
    });

    let notified = 0;
    if (notifyNow) {
      const tenants = await prisma.tenants.findMany({
        where: { owner_id: scope.owner_id, hostel_id: hostelId, status: "ACTIVE", profile_id: { not: null } },
        select: { profile_id: true },
      });
      const results = await Promise.allSettled(
        tenants
          .filter((t): t is { profile_id: string } => Boolean(t.profile_id))
          .map((t) =>
            notificationService.createNotification(
              t.profile_id,
              "New food poll",
              `Your hostel owner started a poll: "${title.trim()}" — have your say.`,
              "food_poll_opened",
            ),
          ),
      );
      notified = results.filter((r) => r.status === "fulfilled").length;
    }

    return apiResponse({ ...poll, notified }, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create poll");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
