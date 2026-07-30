export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutActorFromSession, moveOutService } from "@/lib/services/move-out-service";

/**
 * POST /api/move-out/requests/[id]/feedback — Submit exit feedback
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const body = await req.json();

    const result = await moveOutService.submitFeedback({
      requestId: params.id,
      actor: moveOutActorFromSession(session),
      ratingCleanliness: body.ratingCleanliness,
      ratingFood: body.ratingFood,
      ratingWifi: body.ratingWifi,
      ratingManagement: body.ratingManagement,
      ratingMaintenance: body.ratingMaintenance,
      ratingSafety: body.ratingSafety,
      ratingValue: body.ratingValue,
      overallRating: body.overallRating,
      wouldRecommend: body.wouldRecommend,
      improvementText: body.improvementText,
      experienceText: body.experienceText,
    });

    return apiResponse(result, 201);
  } catch (error: any) {
    const msg = error.message || "Failed to submit feedback";
    if (msg.startsWith("VALIDATION:")) return apiError(msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND:")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN:")) return apiError(msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED:")) return apiError(msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
