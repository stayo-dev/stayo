export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * POST /api/platform-admin/hostels/[id]/reject-listing
 * Body: { reason: string }
 *
 * The other half of `approve-listing`. Until this existed the console could
 * only ever say yes: a hostel the admin had reviewed and declined was
 * indistinguishable from one nobody had opened, so it stayed in the pending
 * queue forever and the owner was never told anything.
 *
 * A reason is **required**, matching the rule owner-document review already
 * follows — a rejection with no reason just makes the owner resubmit the same
 * thing and lands back in the same queue.
 *
 * The listing is left at DRAFT rather than SUSPENDED: suspension is for
 * something that was live and has been pulled, and using it here would
 * misreport a hostel that never listed at all.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason ?? "").trim();
    if (reason.length < 4) {
      return apiError("A reason is required so the owner knows what to fix", "VALIDATION_ERROR", 400);
    }

    const hostel = await prisma.hostels.findUnique({
      where: { id: params.id },
      select: { id: true, owner_id: true, listing_status: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);
    if (hostel.listing_status === "LIVE") {
      return apiError("This hostel is already live — suspend it instead of rejecting", "VALIDATION_ERROR", 400);
    }

    const updated = await prisma.hostels.update({
      where: { id: params.id },
      data: { verification_status: "REJECTED", verification_note: reason },
      select: { id: true, verification_status: true, listing_status: true, verification_note: true },
    });

    await eventLog
      .log("HOSTEL_LISTING_REJECTED", session!.sub, { hostel_id: params.id, reason })
      .catch(() => undefined);

    return apiResponse({ hostel: updated });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to reject listing");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
