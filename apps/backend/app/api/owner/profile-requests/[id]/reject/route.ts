export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

const CHANGE_TYPE = "tenant_self_service_update";

/** POST /api/owner/profile-requests/[id]/reject */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return ApiResponse.error(ApiError.unauthorized());

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const note = typeof body?.reason === "string" ? body.reason.trim() : "";
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const cr = await tx.change_requests.findUnique({ where: { id: params.id } });
      if (!cr) throw new Error("NOT_FOUND: Request not found");
      if (cr.change_type !== CHANGE_TYPE) throw new Error("VALIDATION: Not a tenant profile-change request");
      if (cr.owner_id !== scope.owner_id) throw new Error("FORBIDDEN: Not your tenant's request");
      if (cr.status !== "PENDING") throw new Error(`VALIDATION: Cannot reject a ${cr.status} request`);

      const updated = await tx.change_requests.update({
        where: { id: params.id },
        data: { status: "REJECTED", rejected_by: session.sub, rejected_at: now, updated_at: now },
      });

      await tx.change_request_events.create({
        data: {
          change_request_id: params.id,
          action: "rejected",
          actor_id: session.sub,
          actor_role: "owner",
          notes: note || "Owner rejected the request.",
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
