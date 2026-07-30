export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { authService } from "@/lib/services/auth-service";
import { apiError } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { obligationEngine } from "@/src/services/payments/obligation-engine";
import { verifyIdentityConfirmation, consumeIdentityTokenInTx } from "@/src/services/payments/identity-confirmation-guard";

const IDENTITY_PURPOSE = "CANCEL_OBLIGATION";
const IDENTITY_ACTION  = "cancel_obligation";

/**
 * POST /api/payments/obligations/:id/cancel
 *
 * Cancels (voids) an obligation. Only obligations with no payments
 * can be cancelled. Records a CANCELLED event in the audit trail.
 *
 * For obligations with partial payments, use waive instead.
 *
 * Requires identity token verification (password confirmation).
 *
 * Body: { reason, identityToken|identity_token }
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || user.role !== "OWNER") {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    const body = await req.json().catch(() => ({}));
    const { reason, identityToken, identity_token } = body;
    const token = identityToken || identity_token;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return apiError("Reason is required for cancellation", "VALIDATION_ERROR", 400);
    }

    const identity = await verifyIdentityConfirmation(token, IDENTITY_PURPOSE, IDENTITY_ACTION, user.id);

    // Execute cancellation atomically
    const result = await prisma.$transaction(async (tx: any) => {
      await consumeIdentityTokenInTx(tx, identity.jti);

      return obligationEngine.cancelObligationInTx(tx, {
        obligationId: params.id,
        reason: reason.trim(),
        actorId: user.id,
      });
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Error cancelling obligation:", error);
    const message = String(error?.message ?? error);
    if (message.includes("NOT_FOUND")) return apiError(message, "NOT_FOUND", 404);
    if (message.includes("BAD_REQUEST")) return apiError(message, "BAD_REQUEST", 400);
    if (message.includes("IDENTITY_REQUIRED")) return apiError(message.replace("IDENTITY_REQUIRED: ", ""), "IDENTITY_REQUIRED", 403);
    if (message.includes("IDENTITY_EXPIRED")) return apiError(message.replace("IDENTITY_EXPIRED: ", ""), "IDENTITY_EXPIRED", 403);
    if (message.includes("FORBIDDEN")) return apiError(message, "FORBIDDEN", 403);
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
