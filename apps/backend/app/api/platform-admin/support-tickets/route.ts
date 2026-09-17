export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";

const TICKET_STATUSES = ["OPEN", "RESOLVED"];

/**
 * GET /api/platform-admin/support-tickets?status=OPEN
 *
 * The queue for the Profile → "Raise a Ticket" system (ADR-079) — reports of
 * Stayo app/website problems, not hostel complaints. Defaults to OPEN, the
 * actionable list; RESOLVED is for looking up a past ticket.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);

  try {
    await requireAdminOrManagerPermission(session, "SUPPORT_REPORTS_BUGS");

    const requested = String(req.nextUrl.searchParams.get("status") || "OPEN").toUpperCase();
    if (!TICKET_STATUSES.includes(requested)) {
      return apiError(`status must be one of ${TICKET_STATUSES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const tickets = await prisma.platform_support_tickets.findMany({
      where: { status: requested },
      orderBy: { created_at: "asc" }, // Oldest first — nobody should wait longest.
      take: 200,
      select: {
        id: true,
        category: true,
        subject: true,
        description: true,
        status: true,
        created_at: true,
        resolved_at: true,
        admin_note: true,
        profile: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    return apiResponse({ tickets, status: requested });
  } catch (error: any) {
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    console.error("Detailed API Error [platform-admin.support-tickets]:", error);
    return apiError("Could not load the ticket queue.", "INTERNAL_ERROR", 500);
  }
}
