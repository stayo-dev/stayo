export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

const CHANGE_TYPE = "tenant_self_service_update";

/** POST /api/owner/profile-requests/[id]/approve — applies the tenant's proposed diff to `tenants` (+ synced `profiles.phone` when phone_1 changes). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return ApiResponse.error(ApiError.unauthorized());

  try {
    const scope = resolveOwnerScope(session);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const cr = await tx.change_requests.findUnique({ where: { id: params.id } });
      if (!cr) throw new Error("NOT_FOUND: Request not found");
      if (cr.change_type !== CHANGE_TYPE) throw new Error("VALIDATION: Not a tenant profile-change request");
      if (cr.owner_id !== scope.owner_id) throw new Error("FORBIDDEN: Not your tenant's request");
      if (cr.status !== "PENDING") throw new Error(`VALIDATION: Cannot approve a ${cr.status} request`);
      if (!cr.tenant_id) throw new Error("VALIDATION: Request has no tenant");

      // Only phone_1 and personal_email are governed (2026-08-14 product
      // decision) — diff never contains anything else, so no per-field
      // date parsing is needed here.
      const diff = cr.diff as Record<string, string | null>;
      await tx.tenants.update({ where: { id: cr.tenant_id }, data: diff });

      if (typeof diff.phone_1 === "string" && diff.phone_1) {
        const tenant = await tx.tenants.findUnique({ where: { id: cr.tenant_id }, select: { profile_id: true } });
        if (tenant?.profile_id) {
          await tx.profile.update({ where: { id: tenant.profile_id }, data: { phone: diff.phone_1 } });
        }
      }

      const updated = await tx.change_requests.update({
        where: { id: params.id },
        data: { status: "APPLIED", approved_by: session.sub, approved_at: now, applied_at: now, updated_at: now },
      });

      await tx.change_request_events.create({
        data: {
          change_request_id: params.id,
          action: "applied",
          actor_id: session.sub,
          actor_role: "owner",
          notes: "Owner approved. Changes applied.",
        },
      });

      return updated;
    });

    return ApiResponse.success({ id: result.id, status: result.status });
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    if (msg.startsWith("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    return ApiResponse.error(ApiError.badRequest(msg));
  }
}
