export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/food/tenant/polls/[id]/vote
 * Body: { optionId }
 * `allow_multiple = true` toggles the (poll, tenant, option) row, same as
 * the real food_votes system. `allow_multiple = false` replaces: any other
 * vote row this tenant holds on this poll is removed first, and tapping the
 * already-selected option unselects it (leaves nothing selected) rather than
 * being a no-op — matches the tap-to-toggle language used everywhere else in
 * Food.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const { optionId } = body;
    if (!optionId || typeof optionId !== "string") {
      return apiError("optionId is required", "VALIDATION_ERROR", 400);
    }

    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true, hostel_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const poll = await prisma.food_polls.findFirst({ where: { id, hostel_id: tenant.hostel_id } });
    if (!poll) return apiError("Poll not found", "NOT_FOUND", 404);
    if (poll.status !== "OPEN" || poll.closes_at <= new Date()) {
      return apiError("This poll is closed", "POLL_CLOSED", 409);
    }

    const option = await prisma.food_poll_options.findFirst({ where: { id: optionId, poll_id: id } });
    if (!option) return apiError("That option is not part of this poll", "NOT_FOUND", 404);

    const voted = await prisma.$transaction(async (tx) => {
      const existing = await tx.food_poll_votes.findUnique({
        where: { poll_id_tenant_id_option_id: { poll_id: id, tenant_id: tenant.id, option_id: optionId } },
      });

      if (!poll.allow_multiple) {
        await tx.food_poll_votes.deleteMany({ where: { poll_id: id, tenant_id: tenant.id, option_id: { not: optionId } } });
      }

      if (existing) {
        await tx.food_poll_votes.delete({ where: { poll_id_tenant_id_option_id: { poll_id: id, tenant_id: tenant.id, option_id: optionId } } });
        return false;
      }

      await tx.food_poll_votes.create({ data: { poll_id: id, tenant_id: tenant.id, option_id: optionId } });
      return true;
    });

    return apiResponse({ option_id: optionId, voted });
  } catch (error: any) {
    return apiError(error?.message || "Failed to record vote");
  }
}
