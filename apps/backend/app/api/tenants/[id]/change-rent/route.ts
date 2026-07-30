export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { prisma } from "@/lib/db";
import { applyRentChangeInTx } from "@/src/services/payments/rent-change-service";
import { verifyIdentityConfirmation, consumeIdentityTokenInTx } from "@/src/services/payments/identity-confirmation-guard";

// Matches the (purpose, action) naming convention already used by
// obligation cancel/waive (CANCEL_OBLIGATION/cancel_obligation,
// WAIVE_OBLIGATION/waive_obligation) — see
// app/api/payments/obligations/[id]/cancel/route.ts. Registered in
// app/api/auth/confirm-identity/route.ts's ALLOWED_PURPOSES map so an owner
// can actually obtain a token for this purpose.
const IDENTITY_PURPOSE = "CHANGE_RENT";
const IDENTITY_ACTION = "change_rent";

/**
 * POST /api/tenants/:id/change-rent
 *
 * Changes a tenant's rent, effective from an owner-chosen month, and
 * reprices any not-yet-paid rent obligations at or after that month.
 * Owner-only, no tenant approval — see Business-Rules.md. Identity-confirmed
 * (password re-entry) like obligation cancel/waive, because it is a
 * financially sensitive mutation.
 *
 * Body: { hostelId, newRentAmount, effectiveFromMonth, reason, identityToken }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
    const { hostelId, newRentAmount, effectiveFromMonth, reason, identityToken } = body;

    if (!hostelId) return ApiResponse.error(ApiError.badRequest("hostelId is required"));
    if (!(Number(newRentAmount) > 0)) return ApiResponse.error(ApiError.badRequest("newRentAmount must be greater than 0"));
    if (!effectiveFromMonth) return ApiResponse.error(ApiError.badRequest("effectiveFromMonth is required"));
    if (!reason) return ApiResponse.error(ApiError.badRequest("reason is required"));

    await requireHostelBelongsToOwner(scope.owner_id, hostelId);

    const identity = await verifyIdentityConfirmation(identityToken, IDENTITY_PURPOSE, IDENTITY_ACTION, session.sub);

    const agreement = await prisma.agreement.findFirst({
      where: {
        tenant_id: params.id,
        hostel_id: hostelId,
        status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] },
      },
      orderBy: { generated_at: "desc" },
    });
    if (!agreement) return ApiResponse.error(ApiError.notFound("No active agreement found for this tenant"));

    const result = await prisma.$transaction(async (tx: any) => {
      await consumeIdentityTokenInTx(tx, identity.jti);
      return applyRentChangeInTx(tx, {
        agreementId: agreement.id,
        hostelId,
        newRentAmount: Number(newRentAmount),
        effectiveFromMonth: new Date(effectiveFromMonth),
        actorId: scope.actor_id,
        reason,
      });
    });

    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error in POST [tenants.change-rent]:", error);
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("IDENTITY_REQUIRED")) {
      return ApiResponse.error(new ApiError(msg.replace(/^IDENTITY_REQUIRED:\s*/, ""), 403, "IDENTITY_REQUIRED"));
    }
    if (msg.startsWith("IDENTITY_EXPIRED")) {
      return ApiResponse.error(new ApiError(msg.replace(/^IDENTITY_EXPIRED:\s*/, ""), 403, "IDENTITY_EXPIRED"));
    }
    if (msg.startsWith("FORBIDDEN") || msg.includes("does not belong to hostel")) {
      return ApiResponse.error(ApiError.forbidden(msg));
    }
    if (msg.startsWith("VALIDATION_ERROR")) {
      return ApiResponse.error(ApiError.badRequest(msg));
    }
    if (error?.code === "HOSTEL_CONTEXT_REQUIRED") {
      return ApiResponse.error(ApiError.badRequest(msg));
    }
    return ApiResponse.error(new ApiError(error.message || "Failed to change rent"));
  }
}
