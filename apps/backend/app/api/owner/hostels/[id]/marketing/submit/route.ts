export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingPageService } from "@/src/services/marketing/marketing-page-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * Hand the draft to the admin review queue.
 *
 * Nothing goes live from here — that is the point of the whole cycle. An owner
 * submits; a platform admin decides (ADR-040's boundary, extended from the
 * listing to its content).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }

    const submitted = await marketingPageService.submitForReview(session.sub, params.id);
    return ApiResponse.success(submitted, "Sent to Stayo for review");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
