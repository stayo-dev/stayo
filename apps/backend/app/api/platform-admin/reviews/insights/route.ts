export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { reviewsService } from "@/src/services/discovery/reviews-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * "What are residents talking about" — separate from the moderation queue
 * (`/api/platform-admin/reviews`), which answers "should this be published".
 * Reads the automatic topic/sentiment detection produced at submit time
 * (`hostel_review_topics`), filterable by category, sentiment, hostel and
 * review status. See ADR-115.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "ADMIN") throw ApiError.forbidden("Admin access required");

    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const sentimentParam = url.searchParams.get("sentiment");
    const sentiment =
      sentimentParam === "POSITIVE" || sentimentParam === "NEUTRAL" || sentimentParam === "NEGATIVE"
        ? sentimentParam
        : undefined;
    const hostelId = url.searchParams.get("hostelId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Number(url.searchParams.get("limit")) || undefined;
    const offset = Number(url.searchParams.get("offset")) || undefined;

    return ApiResponse.success(
      await reviewsService.insights({ category, sentiment, hostelId, status, limit, offset }),
    );
  } catch (error) {
    return ApiResponse.error(error);
  }
}
