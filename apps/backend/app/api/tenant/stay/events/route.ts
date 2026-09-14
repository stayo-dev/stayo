export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

const TENANT_SOURCES = new Set(["QR", "APP"]);

/**
 * POST /api/tenant/stay/events
 * Body: { type, leaveType?, expectedReturnDate?, source: "QR"|"APP", idempotencyKey }
 *
 * The tenant and hostel come from the session's live tenancy, never the
 * body. A repeated tap is idempotent. Returns { stay }.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (!TENANT_SOURCES.has(body?.source)) return apiError("source must be QR or APP", "INVALID_REQUEST", 400);

    const me = await stayService.getMyStay(session.sub);
    if (!me.resident || !me.tenantId || !me.hostel) {
      return apiError("Only a current resident can update their stay.", "STAY_INELIGIBLE", 409);
    }

    const stay = await stayService.recordStayEvent({
      tenantId: me.tenantId,
      hostelId: me.hostel.id,
      type: body.type,
      leaveType: body.leaveType,
      expectedReturnDate: body.expectedReturnDate,
      source: body.source,
      actorProfileId: session.sub,
      actorRole: "TENANT",
      idempotencyKey: body.idempotencyKey,
    });
    return apiResponse({ stay });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
