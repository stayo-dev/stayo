export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { invitationService } from "@/src/services/tenants/invitation-service";
import { InvitationUpdateSchema, TenantProfileUpdateSchema } from "@/lib/validators";
import { assertBodySize } from "@/lib/security/api-guard";


/**
 * 👨‍🎓 TENANT BY ID — Get, Update, Delete
 * GET    /api/tenants/[id]
 * PUT    /api/tenants/[id]
 * DELETE /api/tenants/[id]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) {
    console.warn("[tenants.id.GET] Unauthorized access attempt");
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }

  try {
    console.log(`[tenants.id.GET] Fetching tenant ${params.id} for user ${session.sub}`);
    const tenant = await tenantService.getTenantById(params.id, { sub: session.sub, role: session.role });
    
    return ApiResponse.success(tenant);
  } catch (error: any) {
    console.error(`Detailed API Error [tenants.id.GET] (${params.id}):`, error);
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    
    return ApiResponse.error(ApiError.internal("Internal Server Error"));
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[tenants.id.PUT] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));

    if (body?.invitation_edit === true) {
      const validated = InvitationUpdateSchema.safeParse(body);
      if (!validated.success) {
        console.warn(`[tenants.id.PUT] Invitation validation failed for tenant ${params.id}:`, validated.error.format());
        return ApiResponse.error(ApiError.validationError("Validation failed", { issues: validated.error.errors }));
      }
      
      const result = await invitationService.updateInvitation(params.id, scope.owner_id, validated.data);
      
      return ApiResponse.success(result, undefined, result?.email_sent === false ? { status: 202 } : undefined);
    }

    // Validate profile fields with schema (prevents mass-assignment of arbitrary fields)
    const payloadSchema = TenantProfileUpdateSchema.extend({
      reason: z.string().optional(),
    });
    const validated = payloadSchema.safeParse(body);
    if (!validated.success) {
      return ApiResponse.error(ApiError.validationError("Validation failed", { issues: validated.error.errors }));
    }

    const result = await tenantService.updateTenant(params.id, validated.data, scope.owner_id);
    
    if (result.applied) {
      console.log(`[tenants.id.PUT] Tenant ${params.id} updated successfully (immediate apply)`);
      return ApiResponse.success(result.tenant);
    } else {
      console.log(`[tenants.id.PUT] Tenant ${params.id} update pending tenant approval`);
      return ApiResponse.success(result.changeRequest, result.changeRequest.message, { status: 202 });
    }
  } catch (error: any) {
    console.error(`Detailed API Error [tenants.id.PUT] (${params.id}):`, error);
    const msg = typeof error?.message === "string" ? error.message : String(error);
    
    if (msg.startsWith("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("VALIDATION")) return ApiResponse.error(ApiError.validationError(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("ALREADY_EXISTS")) return ApiResponse.error(new ApiError(msg.split(": ")[1] ?? msg, 409, "ALREADY_EXISTS"));
    if (msg.startsWith("CAPACITY_EXCEEDED")) return ApiResponse.error(new ApiError(msg.split(": ")[1] ?? msg, 409, "CAPACITY_EXCEEDED"));
    
    return ApiResponse.error(ApiError.internal("Internal Server Error"));
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[tenants.id.DELETE] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    console.log(`[tenants.id.DELETE] Deleting tenant ${params.id} for owner ${scope.owner_id}`);
    
    const result = await tenantService.deleteTenant(params.id, scope.owner_id);
    
    console.log(`[tenants.id.DELETE] Tenant ${params.id} deleted successfully`);
    return ApiResponse.success(result);
  } catch (error: any) {
    console.error(`Detailed API Error [tenants.id.DELETE] (${params.id}):`, error);
    const msg = typeof error?.message === "string" ? error.message : String(error);
    
    if (msg.startsWith("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    
    return ApiResponse.error(ApiError.internal("Internal Server Error"));
  }
}
