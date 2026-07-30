export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";

/**
 * GET /api/tenants/increment-year?hostelId=xxx - Preview incrementing year of study
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");

    if (!hostelId) {
      return ApiResponse.error(ApiError.validationError("hostelId is required"));
    }

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const result = await tenantService.getIncrementYearPreview(hostelId, scope.owner_id);
    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error in GET [tenants.increment-year]:", error);
    return ApiResponse.error(new ApiError(error.message || "Internal Server Error"));
  }
}

/**
 * POST /api/tenants/increment-year - Execute incrementing year of study
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const hostelId = body.hostelId;

    if (!hostelId) {
      return ApiResponse.error(ApiError.validationError("hostelId is required"));
    }

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const result = await tenantService.executeIncrementYear(hostelId, scope.owner_id);
    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error in POST [tenants.increment-year]:", error);
    return ApiResponse.error(new ApiError(error.message || "Internal Server Error"));
  }
}
