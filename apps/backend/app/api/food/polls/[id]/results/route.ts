export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * GET /api/food/polls/[id]/results
 * Per-option vote tally for one poll, plus turnout.
 */
export async function GET(
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

    const poll = await prisma.food_polls.findFirst({
      where: { id, owner_id: scope.owner_id },
      include: { food_poll_options: { orderBy: { position: "asc" } } },
    });
    if (!poll) return apiError("Poll not found", "NOT_FOUND", 404);

    const tally = await prisma.food_poll_votes.groupBy({
      by: ["option_id"],
      where: { poll_id: id },
      _count: { _all: true },
    });
    const countByOption = new Map(tally.map((t) => [t.option_id, t._count._all]));

    const options = poll.food_poll_options.map((o) => ({ id: o.id, label: o.label, position: o.position, votes: countByOption.get(o.id) ?? 0 }));
    const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);

    const voters = await prisma.food_poll_votes.findMany({
      where: { poll_id: id },
      select: { tenant_id: true },
      distinct: ["tenant_id"],
    });
    const eligibleCount = await prisma.tenants.count({ where: { hostel_id: poll.hostel_id, status: "ACTIVE", profile_id: { not: null } } });

    return apiResponse({
      poll: { id: poll.id, title: poll.title, poll_type: poll.poll_type, meal_type: poll.meal_type, poll_date: poll.poll_date, closes_at: poll.closes_at, status: poll.status },
      options,
      totalVotes,
      voterCount: voters.length,
      eligibleCount,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch poll results");
  }
}
