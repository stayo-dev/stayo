export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { paymentService } from "@/src/services/payments/payment-service";

/**
 * POST /api/owner/payment-claims/[id]  { action: "confirm" | "reject", reason? }
 *
 * The owner's verdict on a tenant's UPI payment claim.
 *
 * **Confirming is where a claim becomes money.** It records rent through the
 * same settlement path the owner's own offline recording uses, so allocation,
 * receipts and the ledger keep one implementation (ADR-234).
 *
 * Deliberately NOT behind step-up identity confirmation, unlike
 * `/api/payments/record-offline`. Step-up guards owner-asserted money with no
 * counterparty; a tenant-initiated claim already carries a second party, a UTR
 * and an audit trail — and a 2-minute ceremony per claim would make this
 * unusable at the volume it is meant for. Rate limiting stands in for it.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const { id } = await context.params;

    // Confirming moves real money in the ledger, so it is capped even though it
    // is not step-up gated.
    const limit = await checkFixedWindowLimit({
      scope: "owner:payment-claims:decide",
      identifier: scope.owner_id,
      maxAttempts: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) return apiError("Too many requests — try again in a minute", "TOO_MANY_REQUESTS", 429);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "confirm") {
      const result = await paymentService.confirmTenantPaymentClaim({
        claimId: id,
        ownerId: scope.owner_id,
        actorId: session!.sub,
      });
      return apiResponse({ state: "CONFIRMED", payment_group_id: result.groupId });
    }

    if (action === "reject") {
      const result = await paymentService.rejectTenantPaymentClaim({
        claimId: id,
        ownerId: scope.owner_id,
        actorId: session!.sub,
        reason: typeof body?.reason === "string" ? body.reason : undefined,
      });
      return apiResponse(result);
    }

    return apiError("action must be confirm or reject", "VALIDATION_ERROR", 400);
  } catch (error: any) {
    const msg = String(error?.message || "Could not update that payment");
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
