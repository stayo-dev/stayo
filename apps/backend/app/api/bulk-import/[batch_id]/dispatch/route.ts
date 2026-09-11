export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";

/**
 * 📨 POST /api/bulk-import/[batch_id]/dispatch
 *
 * Sends the invitations an import created but held back.
 *
 * Importing a hostel that has been running for months puts the owner's books
 * right immediately; it should not put forty messages on forty phones in the
 * same instant. So confirm queues the invitations and this sends them — all of
 * them, a wave at a time, or a chosen few.
 *
 * Each tenant's expiry clock starts when their invitation is actually sent.
 *
 * Access: Owner/Admin, and only their own batch.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { batch_id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can send invitations", "FORBIDDEN", 403);
  }

  try {
    const batch = await prisma.bulk_import_batches.findFirst({
      where: { id: params.batch_id, owner_id: session.sub },
      select: { id: true },
    });
    if (!batch) return apiError("Batch not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const invitationIds = Array.isArray(body?.invitation_ids)
      ? body.invitation_ids.map((id: unknown) => String(id))
      : undefined;
    // A bounded slice even when the caller asks for "everything": each send is
    // a WhatsApp or email round-trip, and 150 of them would outrun the
    // function's time limit. The response says what is left, and the client
    // calls again — the same shape as confirm.
    const MAX_PER_REQUEST = 40;
    const requested = Number(body?.limit);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), MAX_PER_REQUEST)
      : MAX_PER_REQUEST;

    const result = await tenantInvitationLifecycleService.dispatchQueuedInvitations(session.sub, {
      batchId: batch.id,
      invitationIds,
      limit,
    });

    return apiResponse(
      {
        batch_id: batch.id,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
        remaining: result.remaining,
        errors: result.errors.slice(0, 50),
      },
      200
    );
  } catch (error: any) {
    const raw = String(error?.message || "Failed to send invitations");
    const [maybeCode, ...rest] = raw.split(":");
    const code = maybeCode?.trim();
    const message = rest.length ? rest.join(":").trim() : raw;
    const status: Record<string, number> = { NOT_FOUND: 404, FORBIDDEN: 403, VALIDATION_ERROR: 400 };
    return apiError(message, code || "DISPATCH_ERROR", status[code] || 500);
  }
}
