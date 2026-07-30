export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { UtilityType, UtilityStatus } from "@prisma/client";

const VALID_UTILITIES: string[] = Object.values(UtilityType);
const VALID_STATUSES: string[] = Object.values(UtilityStatus);

/**
 * GET /api/utility-status?hostelId=
 * Owner view of all 4 utility rows for a hostel.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const rows = await prisma.hostel_utility_status.findMany({ where: { hostel_id: hostelId! } });
    return apiResponse({ statuses: rows });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch utility status");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}

/**
 * PATCH /api/utility-status
 * Body: { hostelId, utility, status, note? } — upserts one utility's row.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, utility, status, note } = body;

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    if (!utility || !VALID_UTILITIES.includes(utility)) {
      return apiError(`utility must be one of: ${VALID_UTILITIES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      return apiError(`status must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const row = await prisma.hostel_utility_status.upsert({
      where: { hostel_id_utility: { hostel_id: hostelId, utility: utility as UtilityType } },
      create: { hostel_id: hostelId, utility: utility as UtilityType, status: status as UtilityStatus, note: note || null },
      update: { status: status as UtilityStatus, note: note || null, updated_at: new Date() },
    });

    return apiResponse(row);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update utility status");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.split(": ")[1] ?? msg, "HOSTEL_CONTEXT_REQUIRED", 400);
    return apiError(msg);
  }
}
