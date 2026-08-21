export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { reviewsService } from "@/src/services/discovery/reviews-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const ModerateSchema = z.object({
  verdict: z.enum(["PUBLISH", "REJECT"]),
  note: z.string().max(500).optional().nullable(),
});

/**
 * Publish or reject one review — the only path onto a public listing.
 *
 * Admin only, and deliberately not delegated to the hostel's owner: an owner
 * choosing which reviews of their own hostel appear is not a review system,
 * it is a testimonial page. See ADR-086.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "ADMIN") throw ApiError.forbidden("Admin access required");

    const parsed = ModerateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw ApiError.validationError("A verdict is required");

    const result = await reviewsService.moderate(
      session.sub,
      params.id,
      parsed.data.verdict,
      parsed.data.note,
    );
    return ApiResponse.success(result, parsed.data.verdict === "PUBLISH" ? "Published" : "Rejected");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
