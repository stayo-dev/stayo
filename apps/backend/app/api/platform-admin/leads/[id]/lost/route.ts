export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PlatformLeadLostReason } from "@prisma/client";
import { canRejectLead } from "@/src/services/platform-leads/lead-transition-guards";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

const VALID_REASONS: string[] = Object.values(PlatformLeadLostReason);

/**
 * POST /api/platform-admin/leads/[id]/lost
 * Body: { reason, note? }
 *
 * Marks a lead lost with a STRUCTURED reason. Distinct from the existing
 * `/reject` route, which is the applicant-facing decline (it writes
 * `rejection_reason`, which the owner reads on their public status page).
 * This one is internal sales bookkeeping: `lost_reason` is an enum precisely
 * so "why leads are lost" can be counted, which free text never could.
 *
 * Reuses `canRejectLead` so both paths agree on when a lead is still losable
 * — once an activation link exists, this refuses rather than half-cancelling
 * a live invitation.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json();
    const reason = String(body?.reason || "").toUpperCase();

    if (!VALID_REASONS.includes(reason)) {
      return apiError(`reason must be one of: ${VALID_REASONS.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const lead = await prisma.platform_leads.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);

    const guard = canRejectLead(lead.status);
    if (!guard.ok) return apiError(guard.reason, "INVALID_TRANSITION", 409);

    const updated = await prisma.platform_leads.update({
      where: { id },
      data: {
        status: "LOST",
        lost_reason: reason as PlatformLeadLostReason,
        lost_note: body?.note ? String(body.note).trim().slice(0, 2000) : null,
        updated_at: new Date(),
      },
    });

    return apiResponse({ lead: updated });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to mark lead lost");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * DELETE /api/platform-admin/leads/[id]/lost — re-open a lost lead.
 *
 * Returns it to NEW and clears the reason, so a re-opened lead does not show
 * up in the lost-reason chart while actively being worked.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const lead = await prisma.platform_leads.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);
    if (lead.status !== "LOST") {
      return apiError("Only a lost lead can be re-opened", "INVALID_TRANSITION", 409);
    }

    const updated = await prisma.platform_leads.update({
      where: { id },
      data: { status: "NEW", lost_reason: null, lost_note: null, updated_at: new Date() },
    });
    return apiResponse({ lead: updated });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to re-open lead");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
