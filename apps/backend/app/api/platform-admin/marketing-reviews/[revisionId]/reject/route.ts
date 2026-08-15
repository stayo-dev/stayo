export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { marketingReviewService } from "@/src/services/marketing/marketing-review-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const RejectSchema = z.object({ note: z.string().trim().min(1).max(500) });

/**
 * Reject, with a reason.
 *
 * The note is required and owner-visible: it is the owner's only route
 * forward, and a rejection without one just produces a resubmission of the
 * same listing.
 */
export async function POST(req: NextRequest, { params }: { params: { revisionId: string } }) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "ADMIN") {
      throw ApiError.forbidden("Admin access required");
    }

    const parsed = RejectSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw ApiError.validationError("Give a reason — the owner sees it and acts on it");
    }

    const rejected = await marketingReviewService.reject(session.sub, params.revisionId, parsed.data.note);
    return ApiResponse.success(rejected, "Sent back to the owner");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
