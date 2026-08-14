export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { prisma } from "@/lib/db";
import { resolveTenantScope } from "@/lib/auth/resolve-operational-scope";

/**
 * Governed tenant-profile fields — per explicit product decision (2026-08-14,
 * narrowed same day), only phone and email need owner approval before taking
 * effect (identity/contact-sensitive); everything else — including address
 * and date of birth, briefly governed earlier the same day — saves directly
 * via `PATCH /api/tenants/me/profile`. Deliberately NOT routed through
 * `ChangeManagementFacade` — that system is hardwired the other direction
 * (owner proposes, tenant approves; see `change-management-facade.ts`), so
 * this uses the same `change_requests`/`change_request_events` tables but its
 * own creation/approval logic to avoid touching that live feature.
 */
const GOVERNED_FIELDS = ["phone_1", "personal_email"] as const;
type GovernedField = (typeof GOVERNED_FIELDS)[number];

const CHANGE_TYPE = "tenant_self_service_update";

/** GET /api/tenants/me/profile-requests — the tenant's own submitted requests, newest first. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return ApiResponse.error(ApiError.forbidden("Only tenants can access this endpoint"));
  }

  try {
    const scope = await resolveTenantScope(session);
    const requests = await prisma.change_requests.findMany({
      where: { tenant_id: scope.tenant_id, change_type: CHANGE_TYPE },
      orderBy: { created_at: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        diff: true,
        reason: true,
        requested_at: true,
        approved_at: true,
        rejected_at: true,
        applied_at: true,
      },
    });
    return ApiResponse.success({ requests });
  } catch (error: any) {
    return ApiResponse.error(ApiError.badRequest(error?.message || "Failed to load requests"));
  }
}

/** POST /api/tenants/me/profile-requests — submit a proposed change to a governed field, pending owner approval. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return ApiResponse.error(ApiError.forbidden("Only tenants can access this endpoint"));
  }

  try {
    const body = await req.json().catch(() => ({}));
    const fields = body?.fields;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!fields || typeof fields !== "object") {
      return ApiResponse.error(ApiError.badRequest("fields is required"));
    }
    if (!reason) {
      return ApiResponse.error(ApiError.badRequest("A reason is required for changes that need owner approval"));
    }

    const keys = Object.keys(fields) as GovernedField[];
    if (keys.length === 0) {
      return ApiResponse.error(ApiError.badRequest("At least one field is required"));
    }
    const invalidKey = keys.find((k) => !GOVERNED_FIELDS.includes(k));
    if (invalidKey) {
      return ApiResponse.error(ApiError.badRequest(`${invalidKey} is not a governed field`));
    }

    const scope = await resolveTenantScope(session);

    const existingPending = await prisma.change_requests.findFirst({
      where: { tenant_id: scope.tenant_id, change_type: CHANGE_TYPE, status: "PENDING" },
      select: { id: true },
    });
    if (existingPending) {
      return ApiResponse.error(ApiError.badRequest("You already have a change request pending approval — cancel it before submitting another"));
    }

    const current = await prisma.tenants.findUnique({
      where: { id: scope.tenant_id },
      select: { phone_1: true, personal_email: true },
    });
    if (!current) return ApiResponse.error(ApiError.notFound("Tenant record not found"));

    const before: Record<string, unknown> = {};
    const diff: Record<string, unknown> = {};
    for (const key of keys) {
      const newValue = fields[key];
      const oldValue = (current as any)[key] ?? null;
      before[key] = oldValue;
      diff[key] = newValue;
    }

    const cr = await prisma.$transaction(async (tx) => {
      const created = await tx.change_requests.create({
        data: {
          owner_id: scope.owner_id,
          hostel_id: scope.hostel_id,
          tenant_id: scope.tenant_id,
          entity_type: "tenant",
          entity_id: scope.tenant_id,
          change_category: "B",
          change_type: CHANGE_TYPE,
          approval_level: "L1",
          status: "PENDING",
          requested_by: session.sub,
          before: before as any,
          diff: diff as any,
          reason,
        },
      });
      await tx.change_request_events.create({
        data: {
          change_request_id: created.id,
          action: "created",
          actor_id: session.sub,
          actor_role: "tenant",
          notes: reason,
        },
      });
      return created;
    });

    return ApiResponse.success({ id: cr.id, status: cr.status }, "Change submitted for owner approval", { status: 201 });
  } catch (error: any) {
    return ApiResponse.error(ApiError.badRequest(error?.message || "Failed to submit change request"));
  }
}
