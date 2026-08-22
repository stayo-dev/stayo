export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { marketingReviewService } from "@/src/services/marketing/marketing-review-service";
import type { PostApprovalAction } from "@/src/services/marketing/post-approval-transitions";

/**
 * POST /api/platform-admin/hostels/[id]/listing-review — act on a LIVE listing.
 *
 * Keyed on the hostel rather than a revision id, unlike the approve/reject
 * routes: the admin is acting on "what is live for this hostel", and which
 * revision that happens to be is the server's business, not the console's.
 *
 * `action: "REQUEST_CHANGES"` leaves the page up and opens a draft for the owner.
 * `action: "UNPUBLISH"` takes the content down now. Neither removes the hostel
 * from Discovery — that is `suspend-listing`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "") as PostApprovalAction;
    if (action !== "REQUEST_CHANGES" && action !== "UNPUBLISH") {
      return apiError("Unknown action", "VALIDATION_ERROR", 422);
    }

    const result = await marketingReviewService.actOnLiveListing(
      session.sub,
      id,
      action,
      String(body?.note ?? ""),
      body?.flags,
    );
    return apiResponse(result);
  } catch (error: any) {
    return apiError(
      error?.message || "Failed to act on this listing",
      error?.code || "INTERNAL_SERVER_ERROR",
      error?.statusCode || error?.status || 500,
    );
  }
}
