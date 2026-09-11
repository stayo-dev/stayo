export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertOwnerSubscriptionActive, billingErrorResponse } from "@/src/services/platform-billing/subscription-http";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/hostel-events/[id]
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    await assertOwnerSubscriptionActive(scope.owner_id, "hostel-events.id");
    const existing = await prisma.hostel_events.findFirst({ where: { id, owner_id: scope.owner_id } });
    if (!existing) return apiError("Event not found", "NOT_FOUND", 404);

    await prisma.hostel_events.delete({ where: { id } });
    return apiResponse({ deleted: true });
  } catch (error: any) {
    const billing = billingErrorResponse(error);
    if (billing) return billing;
    return apiError(error?.message || "Failed to delete event");
  }
}
