export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";

/**
 * POST /api/platform-admin/support-tickets/[id]/resolve
 * Body: { note?: string }
 *
 * The only thing that can move a ticket out of OPEN — the reporter never can,
 * which is what makes "resolved" mean anything. Re-resolving an already-
 * resolved ticket would silently overwrite the admin note with no record it
 * happened, so a ticket can only be resolved once from OPEN.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;

  try {
    if (!session || session.role !== "ADMIN") {
      return apiError("Admin access only", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    const ticket = await prisma.platform_support_tickets.findUnique({
      where: { id },
      select: { id: true, status: true, profile_id: true },
    });
    if (!ticket) return apiError("Ticket not found", "NOT_FOUND", 404);
    if (ticket.status !== "OPEN") {
      return apiError("This ticket has already been resolved.", "INVALID_TRANSITION", 400);
    }

    const updated = await prisma.platform_support_tickets.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolved_at: new Date(),
        resolved_by: session.sub,
        admin_note: note || null,
      },
      select: {
        id: true,
        status: true,
        resolved_at: true,
        admin_note: true,
      },
    });

    await eventLog.log("PLATFORM_SUPPORT_TICKET_RESOLVED", ticket.profile_id, {
      ticket_id: id,
      resolved_by: session.sub,
    });

    return apiResponse(updated);
  } catch (error: any) {
    console.error("Detailed API Error [platform-admin.support-tickets.resolve]:", error);
    return apiError("Could not resolve that ticket.", "INTERNAL_ERROR", 500);
  }
}
