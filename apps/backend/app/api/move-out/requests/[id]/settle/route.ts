export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutActorFromSession, moveOutService } from "@/lib/services/move-out-service";

/**
 * POST /api/move-out/requests/[id]/settle — Approve settlement
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await moveOutService.approveSettlement(
      params.id,
      moveOutActorFromSession(session),
      body.reviewNotes,
      body.confirmedSettlementAmount != null || body.settlementDirection
        ? {
            amount: Number(body.confirmedSettlementAmount ?? 0),
            direction: body.settlementDirection,
          }
        : undefined,
    );
    return apiResponse(result);
  } catch (error: any) {
    const msg = error.message || "Failed to approve settlement";
    if (msg.startsWith("VALIDATION:")) return apiError(msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND:")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN:")) return apiError(msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED:")) return apiError(msg, "UNAUTHORIZED", 401);
    if (msg.startsWith("DISPUTE_OPEN:")) return apiError(msg, "DISPUTE_OPEN", 409);
    if (msg.startsWith("DISPUTE_REVIEW_REQUIRED:")) return apiError(msg, "DISPUTE_REVIEW_REQUIRED", 409);
    return apiError(msg);
  }
}
