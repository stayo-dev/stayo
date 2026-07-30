export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { safePagination, assertBodySize } from "@/lib/security/api-guard";


/**
 * 👨‍🎓 TENANTS — List & Create
 * GET  /api/tenants/ — List all tenants with search and filters
 * POST /api/tenants/ — Enroll a new tenant (admin/warden only)
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[tenants.GET] Forbidden access attempt by user ${session?.sub}`);
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const { limit, offset } = safePagination(searchParams.get("limit"), searchParams.get("offset"));

    const hostelId = searchParams.get("hostelId") || undefined;
    
    console.log(`[tenants.GET] Fetching tenants for owner ${scope.owner_id}, hostel ${hostelId}`);
    
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);
    if (!hostelId) {
      console.warn("[tenants.GET] Missing hostelId context");
      return ApiResponse.error(ApiError.validationError("hostelId is required", { code: "HOSTEL_CONTEXT_REQUIRED" }));
    }

    const result = await tenantService.getAllTenants({
      status, search, ownerId: scope.owner_id, limit, offset,
      hostelId,
    });

    return ApiResponse.success({ ...result });
  } catch (error: any) {
    console.error("Detailed API Error [tenants.GET]:", error);
    return ApiResponse.error(new ApiError(error.message || "Internal Server Error"));
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[tenants.POST] Forbidden access attempt by user ${session?.sub}`);
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const body = await req.json().catch(() => ({}));

    if (!body.profile_id) {
      return ApiResponse.error(ApiError.validationError("profile_id is required"));
    }
    if (!body.monthly_rent || body.monthly_rent <= 0) {
      return ApiResponse.error(ApiError.validationError("monthly_rent must be > 0"));
    }

    const tenant = await tenantService.createTenant(body, scope.owner_id);
    
    console.log(`[tenants.POST] Tenant created: ${tenant.id}`);
    
    return ApiResponse.success(tenant, undefined, { status: 201 });
  } catch (error: any) {
    console.error("Detailed API Error [tenants.POST]:", error);
    
    return Response.json(
      {
        success: false,
        error: error.message || "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
