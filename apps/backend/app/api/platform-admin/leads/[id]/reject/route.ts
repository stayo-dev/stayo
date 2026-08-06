export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { canRejectLead } from "@/src/services/platform-leads/lead-transition-guards";
import { platformLeadNotificationService } from "@/src/services/platform-leads/platform-lead-notification-service";

/**
 * POST /api/platform-admin/leads/[id]/reject — decline an enquiry and tell
 * the applicant why.
 *
 * Deliberately its own endpoint rather than a PATCH to status=LOST, which
 * stays silent. LOST carries two meanings — "we reviewed and declined" and
 * "went cold, stopped replying" — and only the first should trigger a
 * "we are unable to proceed with your application" message. Symmetric with
 * POST .../approve. See design doc D5.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;

  try {
    if (!session || session.role !== "ADMIN") {
      return apiError("Admin access only", "FORBIDDEN", 403);
    }

    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason || "").trim();
    if (!reason) {
      return apiError("A reason is required — it is sent to the applicant.", "VALIDATION_ERROR", 400);
    }

    const lead = await prisma.platform_leads.findUnique({ where: { id } });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);

    const guard = canRejectLead(lead.status);
    if (!guard.ok) return apiError(guard.reason, "INVALID_TRANSITION", 400);

    const updated = await prisma.platform_leads.update({
      where: { id },
      data: { status: "LOST", rejection_reason: reason, updated_at: new Date() },
    });

    await eventLog.log("LEAD_REJECTED", session.sub, { lead_id: id, reason: reason.slice(0, 500) });

    // Fire-and-forget — the decision is already recorded; a WhatsApp failure
    // must not roll it back or 500 the admin's request.
    void platformLeadNotificationService
      .sendLeadRejected(
        { id: updated.id, name: updated.name, phone: updated.phone, tracking_token: updated.tracking_token },
        reason
      )
      .catch((err) => console.error("[leads.reject] notify failed", err));

    return apiResponse(updated);
  } catch (error: any) {
    console.error("Detailed API Error [platform-admin.leads.reject]:", error);
    return apiError("Could not reject this lead.", "INTERNAL_ERROR", 500);
  }
}
