export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

/**
 * GET /api/change-requests/[id]
 * Fetch a single change request with full event timeline.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized());
  }

  try {
    const cr = await prisma.change_requests.findUnique({
      where: { id: params.id },
      include: {
        events: {
          orderBy: { created_at: "asc" },
        },
        tenant: {
          select: {
            id: true,
            status: true,
            profiles: {
              select: { name: true, phone: true, email: true },
            },
          },
        },
        hostel: {
          select: { id: true, name: true },
        },
      },
    });

    if (!cr) {
      return ApiResponse.error(ApiError.notFound("Change request not found"));
    }

    // Authorization: owner must own this request, tenant must be the subject
    if (session.role === "OWNER" || session.role === "ADMIN") {
      const scope = await resolveOwnerScope(session);
      if (cr.owner_id !== scope.owner_id) {
        return ApiResponse.error(ApiError.forbidden("Access denied"));
      }
    } else if (session.role === "TENANT") {
      if (cr.tenant_id !== session.tenant_id) {
        return ApiResponse.error(ApiError.forbidden("Access denied"));
      }
    }

    return ApiResponse.success({
      id: cr.id,
      entity_type: cr.entity_type,
      entity_id: cr.entity_id,
      entity_version: cr.entity_version,
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
      creates_version: cr.creates_version,
      supersedes_version: cr.supersedes_version,
      tenant: cr.tenant
        ? {
            id: cr.tenant.id,
            status: cr.tenant.status,
            name: (cr.tenant.profiles as any)?.name || "Unknown",
            phone: (cr.tenant.profiles as any)?.phone || null,
            email: (cr.tenant.profiles as any)?.email || null,
          }
        : null,
      hostel: cr.hostel
        ? { id: cr.hostel.id, name: cr.hostel.name }
        : null,
      events: cr.events.map((e: any) => ({
        id: e.id,
        action: e.action,
        actor_id: e.actor_id,
        actor_role: e.actor_role,
        notes: e.notes,
        created_at: e.created_at,
      })),
    });
  } catch (error: any) {
    console.error(`[change-requests.${params.id}.GET] Error:`, error);
    return ApiResponse.error(error);
  }
}
