export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/food/tenant/polls
 * OPEN polls for the tenant's own hostel, with each option's current tally
 * (never per-voter — see is_anonymous note in [[Food]]) and this tenant's
 * own picks marked.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true, hostel_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const polls = await prisma.food_polls.findMany({
      where: { hostel_id: tenant.hostel_id, status: "OPEN" },
      orderBy: { created_at: "desc" },
      include: { food_poll_options: { orderBy: { position: "asc" } } },
    });

    const pollIds = polls.map((p) => p.id);
    const tally = pollIds.length
      ? await prisma.food_poll_votes.groupBy({ by: ["poll_id", "option_id"], where: { poll_id: { in: pollIds } }, _count: { _all: true } })
      : [];
    const myVotes = pollIds.length
      ? await prisma.food_poll_votes.findMany({ where: { poll_id: { in: pollIds }, tenant_id: tenant.id }, select: { poll_id: true, option_id: true } })
      : [];
    const countByOption = new Map(tally.map((t) => [t.option_id, t._count._all]));
    const myOptionsByPoll = new Map<string, Set<string>>();
    for (const v of myVotes) {
      if (!myOptionsByPoll.has(v.poll_id)) myOptionsByPoll.set(v.poll_id, new Set());
      myOptionsByPoll.get(v.poll_id)!.add(v.option_id);
    }

    const result = polls.map((poll) => ({
      id: poll.id,
      title: poll.title,
      poll_type: poll.poll_type,
      meal_type: poll.meal_type,
      poll_date: poll.poll_date,
      closes_at: poll.closes_at,
      allow_multiple: poll.allow_multiple,
      options: poll.food_poll_options.map((o) => ({ id: o.id, label: o.label, position: o.position, votes: countByOption.get(o.id) ?? 0 })),
      myOptionIds: Array.from(myOptionsByPoll.get(poll.id) ?? []),
    }));

    return apiResponse({ polls: result });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch polls");
  }
}
