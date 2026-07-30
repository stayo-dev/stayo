export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/tenants/me/events
 * Upcoming events for the tenant's own hostel, soonest first.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { hostel_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const events = await prisma.hostel_events.findMany({
      where: { hostel_id: tenant.hostel_id, event_date: { gte: new Date(new Date().toDateString()) } },
      orderBy: { event_date: "asc" },
      take: 10,
    });

    return apiResponse({ events });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch events");
  }
}
