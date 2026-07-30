export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * POST /api/food/voting-periods/[id]/close
 * Manually close voting before its scheduled end time.
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

    const period = await prisma.food_voting_periods.findFirst({
      where: { id, owner_id: scope.owner_id },
    });
    if (!period) return apiError("Voting period not found", "NOT_FOUND", 404);

    const updated = await prisma.food_voting_periods.update({
      where: { id },
      data: { status: "CLOSED", updated_at: new Date() },
    });

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to close voting");
  }
}
