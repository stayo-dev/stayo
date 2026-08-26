export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutActorFromSession, moveOutService } from "@/lib/services/move-out-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { MoveOutReason } from "@prisma/client";
import { safePagination, assertBodySize } from "@/lib/security/api-guard";

/**
 * Move-Out Requests — List & Create
 * GET  /api/move-out/requests — List move-out requests (owner)
 * POST /api/move-out/requests — Create a move-out request
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const hostelId = searchParams.get("hostelId");
    if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const status = searchParams.get("status") || undefined;
    const { limit, offset } = safePagination(searchParams.get("limit"), searchParams.get("offset"));

    const result = await moveOutService.listRequests({
      ownerId: scope.owner_id,
      hostelId,
      status,
      limit,
      offset,
    });

    return apiResponse(result);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch move-out requests");
  }
}

const VALID_REASONS: string[] = Object.values(MoveOutReason);

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const body = await req.json().catch(() => ({}));
    const { hostelId, tenantId, reason, reasonText, plannedExitDate } = body;

    if (reasonText && typeof reasonText === "string" && reasonText.length > 1000) {
      return apiError("reasonText must be under 1000 characters", "VALIDATION_ERROR", 400);
    }

    if (!plannedExitDate) return apiError("plannedExitDate is required", "VALIDATION_ERROR", 400);
    if (!reason || !VALID_REASONS.includes(reason)) {
      return apiError(`reason must be one of: ${VALID_REASONS.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    // Determine who is initiating
    let resolvedTenantId = tenantId;
    let resolvedHostelId = hostelId;
    let resolvedOwnerId: string;
    let initiatedByRole: "TENANT" | "OWNER" = "TENANT";

    if (session.role === "TENANT") {
      // Tenant self-service
      /*
       * `findUnique({ where: { profile_id } })` used to be here, and
       * `profile_id` is not a unique index on `tenants` — Prisma rejects that
       * outright, so this branch threw on every call and no tenant has ever
       * been able to file a move-out. It was invisible because nothing on the
       * tenant side called it until now.
       *
       * A profile also has one row per *stay*, so even a working lookup could
       * pick a tenancy the person left years ago. `getActiveTenancy` is the
       * shared helper that resolves the live one, and using it here keeps this
       * route agreeing with the rest of the app about which stay is current.
       */
      const { getActiveTenancy } = await import("@/lib/tenancy/active-tenancy");
      // Returns the whole row; `selectLiveTenancy`'s signature narrows the
      // inferred type, so widen it back rather than re-querying.
      const tenant: any = await getActiveTenancy(session.sub);
      if (!tenant) return apiError("No active tenancy found for this account", "NOT_FOUND", 404);
      resolvedTenantId = tenant.id;
      resolvedHostelId = tenant.hostel_id;
      resolvedOwnerId = tenant.owner_id!;
      initiatedByRole = "TENANT";
    } else if (session.role === "OWNER") {
      // Owner-initiated (eviction or on behalf)
      const scope = resolveOwnerScope(session);
      if (!resolvedTenantId) return apiError("tenantId is required for owner-initiated move-out", "VALIDATION_ERROR", 400);
      if (!resolvedHostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
      await requireHostelBelongsToOwner(scope.owner_id, resolvedHostelId);
      resolvedOwnerId = scope.owner_id;
      initiatedByRole = "OWNER";
    } else {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }

    const result = await moveOutService.createRequest({
      tenantId: resolvedTenantId,
      hostelId: resolvedHostelId,
      ownerId: resolvedOwnerId!,
      initiatedBy: session.sub,
      initiatedByRole,
      actor: moveOutActorFromSession(session),
      reason: reason as MoveOutReason,
      reasonText,
      plannedExitDate,
    });

    return apiResponse(result, 201);
  } catch (error: any) {
    const msg = error.message || "Failed to create move-out request";
    if (msg.startsWith("VALIDATION:")) return apiError(msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND:")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN:")) return apiError(msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
