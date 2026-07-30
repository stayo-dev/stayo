export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { recoveryService } from "@/src/services/recovery/recovery-service";
import "@/src/services/recovery/bootstrap";

/**
 * GET /api/recovery/cases?hostelId=<id>&status=<status>&domain=<domain>
 * List correction cases for a hostel the calling owner actually owns.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  const hostelId = req.nextUrl.searchParams.get("hostelId") || undefined;
  if (!hostelId) {
    return ApiResponse.error(ApiError.badRequest("hostelId is required"));
  }

  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const status = req.nextUrl.searchParams.get("status") || undefined;
    const domain = req.nextUrl.searchParams.get("domain") || undefined;
    const cases = await recoveryService.listCases(hostelId, { status, domain });
    return ApiResponse.success(cases);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("UNAUTHORIZED")) return ApiResponse.error(ApiError.unauthorized(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return ApiResponse.error(ApiError.badRequest(msg.split(": ")[1] ?? msg));
    return ApiResponse.error(ApiError.internal("Failed to list recovery cases"));
  }
}

/**
 * POST /api/recovery/cases
 * Body: { hostelId, caseType, reason, input }
 * Creates a correction case and immediately runs preview (route combines
 * create+preview so the client gets an impact report in one round trip).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, caseType, reason, input } = body;

    if (!hostelId) return ApiResponse.error(ApiError.badRequest("hostelId is required"));
    if (!caseType) return ApiResponse.error(ApiError.badRequest("caseType is required"));
    if (!reason) return ApiResponse.error(ApiError.badRequest("reason is required"));

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const kase = await recoveryService.createCase(caseType, {
      hostelId,
      actor: { actorId: scope.actor_id, actorRole: "OWNER" },
      reason,
      input: input ?? {},
    });
    await recoveryService.preview(kase.id);
    const withPreview = await recoveryService.getCase(kase.id);
    return ApiResponse.success(withPreview);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("UNAUTHORIZED")) return ApiResponse.error(ApiError.unauthorized(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("HOSTEL_CONTEXT_REQUIRED")) return ApiResponse.error(ApiError.badRequest(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("no handler registered")) return ApiResponse.error(ApiError.badRequest(msg));
    return ApiResponse.error(ApiError.internal("Failed to create recovery case"));
  }
}
