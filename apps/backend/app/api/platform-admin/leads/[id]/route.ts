export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
// Only these are manually settable via this generic PATCH. APPROVED onward
// (INVITE_SENT/OWNER_ACTIVATED/HOSTEL_CREATED/LIVE) are system-managed —
// set only by lead-invitation-service.ts's approveLead() and the
// auto-progression choke points in owner-signup/owner-hostels — that's
// what actually guarantees "no manual status updates after invite sent,"
// not just a UI convention. Use POST .../approve to move a lead forward.
const MANUALLY_SETTABLE_STATUSES = ["NEW", "UNDER_REVIEW", "LOST"];

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/** GET /api/platform-admin/leads/[id] — includes a timeline of logged events for the admin drawer. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const lead = await prisma.platform_leads.findUnique({ where: { id } });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);

    // systemEventLog has no lead_id column (only owner_id/tenant_id) — lead
    // events are logged with lead_id inside `metadata`, a deliberate reuse
    // tradeoff over adding a column to a shared table. See Decisions.md.
    const timeline = await (prisma as any).systemEventLog.findMany({
      where: { metadata: { path: ["lead_id"], equals: id } },
      orderBy: { created_at: "desc" },
      take: 50,
    });

    return apiResponse({ ...lead, timeline });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch lead");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * PATCH /api/platform-admin/leads/[id]
 * Body: { status?, notes? } — status is restricted to the manually-settable
 * subset (NEW/UNDER_REVIEW/LOST); use POST .../approve to move a lead to
 * APPROVED and beyond, which also generates and sends the activation link.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const existing = await prisma.platform_leads.findUnique({ where: { id } });
    if (!existing) return apiError("Lead not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const { status, notes } = body;
    if (status && !MANUALLY_SETTABLE_STATUSES.includes(status)) {
      return apiError(
        `status must be one of: ${MANUALLY_SETTABLE_STATUSES.join(", ")} (use POST .../approve to advance further)`,
        "VALIDATION_ERROR",
        400
      );
    }

    const updated = await prisma.platform_leads.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
        updated_at: new Date(),
      },
    });
    return apiResponse(updated);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update lead");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
