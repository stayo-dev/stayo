export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

const OWNER_TYPES = new Set(["LEAVE_STARTED", "RETURN_DATE_CHANGED", "RETURNED", "LEAVE_CANCELLED"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/hostels/[id]/stay/tenants/[tenantId]/events
 * Body: { type, leaveType?, expectedReturnDate?, idempotencyKey }
 *
 * The owner updating a resident's stay — the only path for owner-managed
 * tenants who cannot sign in. Always recorded with source OWNER. The tenant
 * must be a resident of this hostel (the service checks).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; tenantId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, tenantId } = await params;
  if (!UUID.test(tenantId)) return apiError("Resident not found", "NOT_FOUND", 404);
  try {
    const body = await req.json().catch(() => ({}));
    if (!OWNER_TYPES.has(body?.type)) {
      return apiError("An owner can start, change, end or cancel a leave", "INVALID_REQUEST", 400);
    }
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const stay = await stayService.recordStayEvent({
      tenantId,
      hostelId: id,
      type: body.type,
      leaveType: body.leaveType,
      expectedReturnDate: body.expectedReturnDate,
      source: "OWNER",
      actorProfileId: session.sub,
      actorRole: "OWNER",
      idempotencyKey: body.idempotencyKey,
    });
    return apiResponse({ stay });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
