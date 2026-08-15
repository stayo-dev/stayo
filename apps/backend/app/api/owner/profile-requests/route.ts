export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

const CHANGE_TYPE = "tenant_self_service_update";

/** GET /api/owner/profile-requests — pending tenant-submitted profile-change requests across the owner's hostels. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return ApiResponse.error(ApiError.unauthorized());

  try {
    const scope = resolveOwnerScope(session);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "PENDING";

    const requests = await prisma.change_requests.findMany({
      where: { owner_id: scope.owner_id, change_type: CHANGE_TYPE, status: status as any },
      orderBy: { created_at: "desc" },
      take: 50,
      include: {
        tenant: {
          select: {
            id: true,
            room_allocations: {
              where: { is_active: true, end_date: null },
              select: { room: { select: { room_no: true } } },
              take: 1,
            },
            profiles: { select: { name: true } },
          },
        },
      },
    });

    const shaped = requests.map((cr: any) => ({
      id: cr.id,
      status: cr.status,
      before: cr.before,
      diff: cr.diff,
      reason: cr.reason,
      requested_at: cr.requested_at,
      tenant: cr.tenant
        ? {
            id: cr.tenant.id,
            name: cr.tenant.profiles?.name ?? "Unknown",
            room_no: cr.tenant.room_allocations?.[0]?.room?.room_no ?? null,
          }
        : null,
    }));

    return ApiResponse.success({ requests: shaped });
  } catch (error: any) {
    return ApiResponse.error(ApiError.badRequest(error?.message || "Failed to load requests"));
  }
}
