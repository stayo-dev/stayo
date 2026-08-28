export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { ownerManagedTenancyService } from "@/src/services/tenants/owner-managed-tenancy-service";

/**
 * 📍 POST /api/tenants/[id]/adopt
 *
 * "Keep records myself" — the owner takes over a tenancy whose invitation the
 * tenant ignored. The tenancy becomes ACTIVE and OWNER_MANAGED, so rent
 * generation, room capacity, analytics and reminders (all of which key on
 * ACTIVE) begin working. The invitation is superseded, not cancelled: the
 * tenant may still claim this tenancy later.
 *
 * Access: Owner/Admin only, scoped to their own tenants and an explicit hostel.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const body = await req.json().catch(() => ({}));
  const hostelId = String(body?.hostel_id || "");
  if (!hostelId) {
    return apiError("hostel_id is required", "VALIDATION_ERROR", 400);
  }

  try {
    const result = await ownerManagedTenancyService.adopt({
      tenantId: params.id,
      ownerId: session.sub,
      hostelId,
      displayName: body?.display_name,
      note: body?.note,
      ip: req.headers.get("x-forwarded-for"),
    });
    return apiResponse(result, 200);
  } catch (error: any) {
    const message = String(error?.message || "Failed to adopt tenant");
    const [code] = message.split(":");
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      CONFLICT: 409,
      VALIDATION_ERROR: 400,
      CAPACITY_EXCEEDED: 409,
    };
    const status = statusMap[code] ?? 500;
    if (status === 500) console.error("Detailed API Error [tenants.adopt.POST]:", error);
    return apiError(message.replace(/^[A-Z_]+:\s*/, ""), code || "ADOPT_ERROR", status);
  }
}
