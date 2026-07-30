export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutActorFromSession, moveOutService } from "@/lib/services/move-out-service";

/**
 * POST /api/move-out/requests/[id]/inspect — Submit room inspection
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const result = await moveOutService.submitInspection({
      requestId: params.id,
      inspectedBy: session.sub,
      actor: moveOutActorFromSession(session),
      roomCondition: body.roomCondition || "GOOD",
      cleaningStatus: body.cleaningStatus || "CLEAN",
      damagesAmount: Number(body.damagesAmount) || 0,
      cleaningFee: Number(body.cleaningFee) || 0,
      missingItemsFee: Number(body.missingItemsFee) || 0,
      otherDeductions: Number(body.otherDeductions) || 0,
      deductionNotes: body.deductionNotes || null,
      evidenceUrls: body.evidenceUrls || [],
      notes: body.notes || null,
      items: body.items || [],
    });

    return apiResponse(result);
  } catch (error: any) {
    const msg = error.message || "Failed to submit inspection";
    if (msg.startsWith("VALIDATION:")) return apiError(msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND:")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN:")) return apiError(msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED:")) return apiError(msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
