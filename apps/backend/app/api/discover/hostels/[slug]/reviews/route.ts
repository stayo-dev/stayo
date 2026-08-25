export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { reviewsService } from "@/src/services/discovery/reviews-service";
import { requireSeeker, getSeeker } from "@/src/services/discovery/seeker-session";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const ReviewSchema = z.object({
  /** Overall Experience — its own question, not derived from the categories (ADR-115). */
  overall: z.number().int().min(1).max(5),
  /** Per-category scores, keyed by `REVIEW_CATEGORIES`. */
  categories: z.record(z.string(), z.number().int().min(1).max(5)),
  body: z.string().max(1500).optional().nullable(),
});

/**
 * A hostel's published reviews.
 *
 * **Public**, and published-only: nothing pending or rejected is served here,
 * whoever is asking. When a seeker is signed in, their own review rides along
 * whatever its state, so the page can tell them theirs is with Stayo rather
 * than letting it appear to vanish.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const published = await reviewsService.listPublished(params.slug);
    const seeker = await getSeeker(req);
    const [mine, eligibility] = await Promise.all([
      seeker ? reviewsService.getMine(seeker.id, params.slug) : Promise.resolve(null),
      reviewsService.eligibility(seeker?.id ?? null, params.slug),
    ]);
    // The page needs to know who may write *before* they write: telling
    // someone at submit time that they were never eligible is the worst
    // moment to say it.
    return ApiResponse.success({ ...published, mine, eligibility });
  } catch (error) {
    return ApiResponse.error(error);
  }
}

/**
 * Write or replace a review. **Signed-in accounts only** — an open text field
 * attached to a named business is not something to accept from an anonymous
 * visitor, and one account gets one review per hostel (a unique index, not a
 * hopeful check).
 *
 * Always lands as PENDING. Nothing here publishes anything.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const seeker = await requireSeeker(req);
    const parsed = ReviewSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw ApiError.validationError(parsed.error.issues[0]?.message ?? "Check your review");
    }

    const review = await reviewsService.submit(seeker, params.slug, parsed.data);
    return ApiResponse.success(review, "Sent to Stayo for checking");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
