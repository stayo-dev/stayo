export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { ServiceRequestStatus } from "@prisma/client";
import { notificationService } from "@/lib/services/notification-service";

const VALID_STATUSES: string[] = Object.values(ServiceRequestStatus);

const STATUS_LABEL: Record<string, string> = {
  RAISED: "Raised",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
};

/**
 * PATCH /api/service-requests/[id]/status
 * Owner assigns/progresses/resolves/rejects a request. Body:
 * { status, note?, assignedTo?, eta?, feeAmount? } — appends a timeline event.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const existing = await prisma.tenant_service_requests.findFirst({
      where: { id },
      include: {
        hostels: { select: { owner_id: true } },
        tenants: { select: { profile_id: true } },
      },
    });
    if (!existing || existing.hostels.owner_id !== scope.owner_id) {
      return apiError("Request not found", "NOT_FOUND", 404);
    }

    const body = await req.json().catch(() => ({}));
    const { status, note, assignedTo, eta, feeAmount } = body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return apiError(`status must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const updated = await prisma.tenant_service_requests.update({
      where: { id },
      data: {
        status: status as ServiceRequestStatus,
        updated_at: new Date(),
        ...(assignedTo !== undefined ? { assigned_to: assignedTo || null } : {}),
        ...(eta !== undefined ? { eta: eta ? new Date(eta) : null } : {}),
        ...(feeAmount !== undefined ? { fee_amount: feeAmount ?? null } : {}),
      },
    });

    const trimmedNote = typeof note === "string" && note.trim() ? note.trim() : null;

    await prisma.tenant_service_request_events.create({
      data: {
        request_id: id,
        status: status as ServiceRequestStatus,
        note: trimmedNote,
        actor_role: "OWNER",
      },
    });

    const tenantProfileId = existing.tenants.profile_id;
    if (tenantProfileId) {
      const ticketLabel = existing.category ?? existing.type.replace(/_/g, " ");
      // Fire-and-forget: the status update has already committed, so a
      // notification failure is logged and swallowed rather than surfacing
      // as a failed status update (matches the tenancy-claim precedent).
      notificationService
        .createNotification(
          tenantProfileId,
          `${ticketLabel} update`,
          trimmedNote ?? `Status updated to ${STATUS_LABEL[status] ?? status}`,
          "service_request",
          { requestId: id },
        )
        .catch((err) => console.error("[service-requests/status] failed to notify tenant:", err));
    }

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to update service request");
  }
}
