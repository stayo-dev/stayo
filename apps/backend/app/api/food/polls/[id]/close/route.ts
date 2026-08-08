export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * POST /api/food/polls/[id]/close
 * Manually close a poll before its scheduled closes_at. Idempotent.
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

    const poll = await prisma.food_polls.findFirst({
      where: { id, owner_id: scope.owner_id },
    });
    if (!poll) return apiError("Poll not found", "NOT_FOUND", 404);

    if (poll.status === "CLOSED") {
      return apiResponse(poll);
    }

    const updated = await prisma.food_polls.update({
      where: { id },
      data: { status: "CLOSED", closed_at: new Date(), updated_at: new Date() },
    });

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to close poll");
  }
}
