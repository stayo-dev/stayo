export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { ownerActionRegistry } from "@/src/services/owner-actions/owner-action-registry";
import "@/src/services/owner-actions/bootstrap";

/**
 * GET /api/owner-actions?entity=tenant&tenantId=<id>
 * Read-only catalog of owner-facing actions available for the given entity.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }

  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity");
  const tenantId = searchParams.get("tenantId");

  if (!entity || !tenantId) {
    return ApiResponse.error(ApiError.badRequest("entity and tenantId are required"));
  }

  try {
    const tenant = await tenantService.getTenantById(tenantId, { sub: session.sub, role: session.role });
    const list = ownerActionRegistry.listForEntity(entity, {
      tenantStatus: tenant.status,
      actorRole: session.role,
    });
    return ApiResponse.success(list);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    return ApiResponse.error(ApiError.internal("Internal Server Error"));
  }
}
