export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutActorFromSession, moveOutService } from "@/lib/services/move-out-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { MoveOutReason } from "@prisma/client";
import { assertBodySize } from "@/lib/security/api-guard";

const VALID_REASONS: string[] = Object.values(MoveOutReason);
const VALID_DIRECTIONS = ["OWNER_OWES_TENANT", "TENANT_OWES_OWNER", "SETTLED"];

/**
 * POST /api/move-out/quick-exit — close a whole move-out in one owner action.
 *
 * Owner-only, and deliberately not reachable by a tenant: the fast lane skips
 * the inspection conversation, which is the owner's to skip. A tenant-initiated
 * exit still goes through `POST /api/move-out/requests` and the staged flow.
 *
 * `expectedNet`/`expectedDirection` are required, not optional. They are what
 * the caller had on screen; the service recomputes and refuses (409
 * STALE_PREVIEW) if the settlement moved underneath the owner. See
 * `moveOutService.quickExit` for why that guard is what makes one tap safe.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { hostelId, tenantId, reason, reasonText, plannedExitDate, physicalExitDate } = body;

    if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
    if (!tenantId) return apiError("tenantId is required", "VALIDATION_ERROR", 400);
    if (!plannedExitDate) return apiError("plannedExitDate is required", "VALIDATION_ERROR", 400);
    if (!reason || !VALID_REASONS.includes(reason)) {
      return apiError(`reason must be one of: ${VALID_REASONS.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    if (reasonText && typeof reasonText === "string" && reasonText.length > 1000) {
      return apiError("reasonText must be under 1000 characters", "VALIDATION_ERROR", 400);
    }
    if (typeof body.expectedNet !== "number" || !Number.isFinite(body.expectedNet)) {
      return apiError("expectedNet is required", "VALIDATION_ERROR", 400);
    }
    if (!VALID_DIRECTIONS.includes(body.expectedDirection)) {
      return apiError(`expectedDirection must be one of: ${VALID_DIRECTIONS.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    // Same default as the staged `complete` route: never write off a former
    // tenant's dues unless the caller said so in words (ADR-122).
    const duesDisposition = body.duesDisposition === "WAIVE" ? "WAIVE" : "RECOVERABLE";

    const result = await moveOutService.quickExit({
      hostelId,
      tenantId,
      actor: moveOutActorFromSession(session),
      reason,
      reasonText,
      plannedExitDate,
      physicalExitDate,
      paymentMethod: body.paymentMethod,
      paymentReference: body.paymentReference,
      paymentNotes: body.paymentNotes,
      duesDisposition,
      expectedNet: body.expectedNet,
      expectedDirection: body.expectedDirection,
    });

    return apiResponse(result);
  } catch (error: any) {
    const msg = error.message || "Failed to complete move-out";
    if (msg.startsWith("STALE_PREVIEW:")) return apiError(msg, "STALE_PREVIEW", 409);
    if (msg.startsWith("VALIDATION:")) return apiError(msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND:")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN:")) return apiError(msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED:")) return apiError(msg, "UNAUTHORIZED", 401);
    if (msg.startsWith("DISPUTE_OPEN:")) return apiError(msg, "DISPUTE_OPEN", 409);
    if (msg.startsWith("DISPUTE_REVIEW_REQUIRED:")) return apiError(msg, "DISPUTE_REVIEW_REQUIRED", 409);
    if (msg.startsWith("INVALID_TRANSITION:")) return apiError(msg, "INVALID_TRANSITION", 409);
    return apiError(msg);
  }
}
