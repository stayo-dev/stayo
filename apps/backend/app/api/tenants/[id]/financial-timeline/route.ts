export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { financialTimelineService } from "@/src/services/payments/financial-timeline-service";

/**
 * GET /api/tenants/[id]/financial-timeline?hostelId=&limit=&offset=
 *
 * Unified, read-only financial activity feed for a tenant — merges obligations,
 * payments, settlement groups, ledger entries, and change requests via
 * financialTimelineService.getTenantTimeline().
 *
 * Auth: OWNER or ADMIN only. financialTimelineService does not assert tenant
 * ownership itself (unlike tenantFinancialLedgerService.getBalance), so this
 * route enforces it explicitly before calling the service.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const ownerId = await resolveOwnerId(session);

    const tenant = await prisma.tenants.findUnique({
      where: { id: params.id },
      select: { owner_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);
    if (tenant.owner_id !== ownerId) {
      return apiError("Tenant does not belong to this owner", "FORBIDDEN", 403);
    }

    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId") || searchParams.get("hostel_id") || undefined;
    const limit = Number(searchParams.get("limit") ?? 50);
    const offset = Number(searchParams.get("offset") ?? 0);

    const result = await financialTimelineService.getTenantTimeline(params.id, {
      hostelId,
      limit,
      offset,
    });
    return apiResponse(result);
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    if (msg.includes("NOT_FOUND")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.includes("FORBIDDEN")) return apiError(msg, "FORBIDDEN", 403);
    return apiError(msg, "INTERNAL_ERROR", 500);
  }
}

async function resolveOwnerId(session: any): Promise<string> {
  if (session.role === "OWNER") return session.sub;
  // ADMIN: must pass owner_id or act globally — use session.sub as fallback
  return session.sub;
}
