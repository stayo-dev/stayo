export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";
import { LIVE_TENANCY_STATUSES } from "@/lib/tenancy/active-tenancy";

/**
 * GET /api/announcements?hostelId=
 * List announcements for a hostel, newest first.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const announcements = await prisma.hostel_announcements.findMany({
      where: { hostel_id: hostelId! },
      orderBy: { created_at: "desc" },
      take: 50,
    });

    return apiResponse({ announcements });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch announcements");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}

/**
 * POST /api/announcements
 * Body: { hostelId, title, body }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, title, body: text } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedBody = typeof text === "string" ? text.trim() : "";
    if (!trimmedTitle) return apiError("title is required", "VALIDATION_ERROR", 400);
    if (!trimmedBody) return apiError("body is required", "VALIDATION_ERROR", 400);

    const announcement = await prisma.hostel_announcements.create({
      data: { hostel_id: hostelId, owner_id: scope.owner_id, title: trimmedTitle, body: trimmedBody },
    });

    // Fan out to every live tenant of this hostel who has an account —
    // fire-and-forget, mirrors the tenancy-claim/food-publish notification
    // precedents so one failed send never blocks the announcement itself.
    prisma.tenants
      .findMany({
        where: { hostel_id: hostelId, status: { in: [...LIVE_TENANCY_STATUSES] }, profile_id: { not: null } },
        select: { profile_id: true },
      })
      .then((tenants: { profile_id: string | null }[]) =>
        Promise.allSettled(
          tenants.map((t) =>
            notificationService.createNotification(t.profile_id as string, trimmedTitle, trimmedBody, "announcement"),
          ),
        ),
      )
      .catch((err: unknown) => console.error("[announcements] failed to fan out tenant notifications:", err));

    return apiResponse(announcement, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create announcement");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
