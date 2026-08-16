export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { marketingReviewService } from "@/src/services/marketing/marketing-review-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * The note is now optional at the schema level because a flagged section is
 * itself actionable feedback. The service still refuses a send-back carrying
 * NEITHER — that check lives in one place (isSendBackActionable) rather than
 * being duplicated here.
 */
const RejectSchema = z.object({
  note: z.string().trim().max(500).optional().default(""),
  flags: z
    .array(z.object({ section: z.string(), note: z.string().max(1000).optional() }))
    .max(6)
    .optional()
    .default([]),
});

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

    const rejected = await marketingReviewService.reject(session.sub, params.revisionId, parsed.data.note, parsed.data.flags);
    return ApiResponse.success(rejected, "Sent back to the owner");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
