export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { ServiceRequestStatus } from "@prisma/client";

const VALID_STATUSES: string[] = Object.values(ServiceRequestStatus);

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
      include: { hostels: { select: { owner_id: true } } },
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

    await prisma.tenant_service_request_events.create({
      data: {
        request_id: id,
        status: status as ServiceRequestStatus,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
        actor_role: "OWNER",
      },
    });

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to update service request");
  }
}
