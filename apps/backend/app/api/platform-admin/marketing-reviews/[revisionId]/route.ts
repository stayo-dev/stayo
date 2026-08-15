export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingReviewService } from "@/src/services/marketing/marketing-review-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * One submission in full, alongside `live` — the revision Discovery is showing
 * right now — so the reviewer judges the *change*, not just the proposal.
 */
export async function GET(req: NextRequest, { params }: { params: { revisionId: string } }) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "ADMIN") {
      throw ApiError.forbidden("Admin access required");
    }

    const submission = await marketingReviewService.getSubmission(params.revisionId);
    return ApiResponse.success(submission);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
