export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/tenants/me/announcements
 * Announcements for the tenant's own hostel, newest first.
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

    const announcements = await prisma.hostel_announcements.findMany({
      where: { hostel_id: tenant.hostel_id },
      orderBy: { created_at: "desc" },
      take: 10,
    });

    return apiResponse({ announcements });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch announcements");
  }
}
