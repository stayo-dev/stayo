export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingReviewService } from "@/src/services/marketing/marketing-review-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * The marketing review queue — every listing waiting on a human, oldest first.
 *
 * Each row carries `flags`: price drift against real `rooms.base_rent`, and
 * bed tiers advertising sharing types the hostel has no rooms for. Neither
 * blocks approval; they are the things a reviewer cannot see by eye.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "ADMIN") {
      throw ApiError.forbidden("Admin access required");
    }

    const pending = await marketingReviewService.listPending();
    return ApiResponse.success(pending);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
