export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";

/**
 * GET /api/hostel-events?hostelId=&upcomingOnly=
 * List hostel events, soonest first. (Named distinctly from /api/events, which
 * is the unrelated owner-dashboard SSE stream.)
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
    const upcomingOnly = searchParams.get("upcomingOnly") === "true";

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const events = await prisma.hostel_events.findMany({
      where: {
        hostel_id: hostelId!,
        ...(upcomingOnly ? { event_date: { gte: new Date(new Date().toDateString()) } } : {}),
      },
      orderBy: { event_date: "asc" },
      take: 50,
    });

    return apiResponse({ events });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch events");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}

/**
 * POST /api/hostel-events
 * Body: { hostelId, title, eventDate, description? }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, title, eventDate, description } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    if (!trimmedTitle) return apiError("title is required", "VALIDATION_ERROR", 400);
    const parsedDate = eventDate ? new Date(eventDate) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
      return apiError("eventDate is required (ISO date)", "VALIDATION_ERROR", 400);
    }

    const event = await prisma.hostel_events.create({
      data: {
        hostel_id: hostelId,
        owner_id: scope.owner_id,
        title: trimmedTitle,
        event_date: parsedDate,
        description: typeof description === "string" && description.trim() ? description.trim() : null,
      },
    });

    return apiResponse(event, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create event");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
