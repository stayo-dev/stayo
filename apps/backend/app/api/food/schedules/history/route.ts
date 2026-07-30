export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";

/**
 * GET /api/food/schedules/history?hostelId=
 * Every published month for this hostel, newest first (meals omitted — the
 * owner picks a month to drill into via GET /api/food/schedules?month=).
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

    const schedules = await prisma.food_schedules.findMany({
      where: { hostel_id: hostelId!, status: "PUBLISHED" },
      orderBy: { month: "desc" },
      select: { id: true, month: true, status: true, published_at: true },
    });

    return apiResponse({ schedules });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch schedule history");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
