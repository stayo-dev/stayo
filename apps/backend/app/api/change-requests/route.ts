export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

/**
 * GET /api/change-requests
 * List change requests with filters.
 * 
 * Query params:
 *   tenantId  – filter by tenant
 *   hostelId  – filter by hostel
 *   status    – PENDING, APPLIED, REJECTED, CANCELLED, EXPIRED, SUPERSEDED
 *   page      – pagination (default 1)
 *   limit     – page size (default 20, max 100)
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized());
  }

  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenantId");
    const hostelId = url.searchParams.get("hostelId");
    const status = url.searchParams.get("status");
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;

    // Build where clause based on role
    const where: Record<string, any> = {};

    if (session.role === "OWNER" || session.role === "ADMIN") {
      // Owner sees all requests they created or for their hostels
      const scope = await resolveOwnerScope(session);
      where.owner_id = scope.owner_id;
      if (hostelId) where.hostel_id = hostelId;
    } else if (session.role === "TENANT") {
      // Tenant sees only requests for their tenant record
      where.tenant_id = session.tenant_id;
    } else {
      return ApiResponse.error(ApiError.forbidden("Insufficient permissions"));
    }

    if (tenantId) where.tenant_id = tenantId;
    if (status) where.status = status;

    const [requests, total] = await Promise.all([
      prisma.change_requests.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: offset,
        take: limit,
        include: {
          events: {
            orderBy: { created_at: "asc" },
            select: {
              id: true,
              action: true,
              actor_role: true,
              notes: true,
              created_at: true,
            },
          },
          tenant: {
            select: {
              id: true,
              profiles: {
                select: { name: true, phone: true },
              },
            },
          },
        },
      }),
      prisma.change_requests.count({ where }),
    ]);

    // Shape response — include tenant name + room for display
    const shaped = requests.map((cr: any) => ({
      id: cr.id,
      entity_type: cr.entity_type,
      change_category: cr.change_category,
      change_type: cr.change_type,
      approval_level: cr.approval_level,
      status: cr.status,
      before: cr.before,
      diff: cr.diff,
      reason: cr.reason,
      effective_date: cr.effective_date,
      requested_at: cr.requested_at,
      approved_at: cr.approved_at,
      rejected_at: cr.rejected_at,
      applied_at: cr.applied_at,
      cancelled_at: cr.cancelled_at,
      expires_at: cr.expires_at,
      tenant: cr.tenant
        ? {
            id: cr.tenant.id,
            name: (cr.tenant.profiles as any)?.name || "Unknown",
            phone: (cr.tenant.profiles as any)?.phone || null,
          }
        : null,
      events: cr.events,
    }));

    return ApiResponse.success({
      requests: shaped,
      total,
      page,
      limit,
    });
  } catch (error: any) {
    console.error("[change-requests.GET] Error:", error);
    return ApiResponse.error(error);
  }
}
