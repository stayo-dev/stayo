export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingReviewService } from "@/src/services/marketing/marketing-review-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * Approve a submission and retire whatever was live.
 *
 * Approving this content does **not** on its own make the hostel discoverable:
 * `listing_status` / `verification_status` remain the separate ADR-040 gate,
 * and nothing here writes them. A listing needs both.
 */
export async function POST(req: NextRequest, { params }: { params: { revisionId: string } }) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "ADMIN") {
      throw ApiError.forbidden("Admin access required");
    }

    const body = await req.json().catch(() => ({}));
    const approved = await marketingReviewService.approve(session.sub, params.revisionId, body?.note);
    return ApiResponse.success(approved, "Listing approved and live");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
