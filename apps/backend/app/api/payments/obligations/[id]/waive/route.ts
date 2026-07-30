export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { authService } from "@/lib/services/auth-service";
import { apiError } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { obligationEngine } from "@/src/services/payments/obligation-engine";
import { eventSystem } from "@/lib/events";
import { verifyIdentityConfirmation, consumeIdentityTokenInTx } from "@/src/services/payments/identity-confirmation-guard";

const IDENTITY_PURPOSE = "WAIVE_OBLIGATION";
const IDENTITY_ACTION  = "waive_obligation";

/**
 * POST /api/payments/obligations/:id/waive
 *
 * Waives an obligation — writes off the outstanding balance and creates
 * a ledger correction entry. Records a WAIVED event in the audit trail.
 *
 * Requires identity token verification (password confirmation).
 *
 * Body: { reason?, identityToken|identity_token }
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

    const identity = await verifyIdentityConfirmation(token, IDENTITY_PURPOSE, IDENTITY_ACTION, user.id);

    const effectiveReason = reason || "Manual waiver by owner";

    // Execute waiver atomically via the obligation engine
    const result = await prisma.$transaction(async (tx: any) => {
      await consumeIdentityTokenInTx(tx, identity.jti);

      return obligationEngine.waiveObligationInTx(tx, {
        obligationId: params.id,
        reason: effectiveReason,
        actorId: user.id,
      });
    });

    // Fire-and-forget post-commit event
    eventSystem.trigger("rent_waived", {
      obligationId: params.id,
      userId: user.id,
      waivedAmount: result.waivedAmount,
    }).catch(() => {});

    return NextResponse.json(result.obligation);
  } catch (error: any) {
    console.error("Error waiving obligation:", error);
    const message = String(error?.message ?? error);
    if (message.includes("NOT_FOUND")) return apiError(message, "NOT_FOUND", 404);
    if (message.includes("BAD_REQUEST")) return apiError(message, "BAD_REQUEST", 400);
    if (message.includes("IDENTITY_REQUIRED")) return apiError(message.replace("IDENTITY_REQUIRED: ", ""), "IDENTITY_REQUIRED", 403);
    if (message.includes("IDENTITY_EXPIRED")) return apiError(message.replace("IDENTITY_EXPIRED: ", ""), "IDENTITY_EXPIRED", 403);
    if (message.includes("FORBIDDEN")) return apiError(message, "FORBIDDEN", 403);
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
