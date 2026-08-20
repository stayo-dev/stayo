import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";
import {
  categoriesFor,
  isValidRating,
  normaliseReviewBody,
  overallFromCategories,
  reviewerDisplayName,
  summariseReviews,
} from "./review-summary";
import { reviewEligibility, type ReviewEligibility } from "./review-eligibility";
import { DISCOVERABLE } from "./discovery-service";

/**
 * Hostel reviews — written by signed-in residents, published only by an admin.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 *   write ──▶ PENDING ──publish──▶ PUBLISHED ──▶ visible on the listing
 *                  │
 *                  └──reject──▶ REJECTED (author sees the reason)
 *
 * Nothing a member of the public writes reaches a hostel's listing without a
 * human at Stayo putting it there. That is not a moderation nicety: the page
 * carries a real business's name, Stayo's verification badge, and an enquiry
 * button, and an unmoderated text field on it is a liability to the hostel and
 * to Stayo alike. See ADR-086.
 *
 * Editing a published review returns it to PENDING — otherwise "approve once,
 * rewrite afterwards" is an open door straight onto the page.
 */

const CATEGORY_SELECT = {
  rating_cleanliness: true,
  rating_food: true,
  rating_safety: true,
  rating_staff: true,
  rating_value: true,
  rating_location: true,
} as const;

const PUBLIC_REVIEW_SELECT = {
  id: true,
  rating: true,
  body: true,
  stayed_here: true,
  created_at: true,
  ...CATEGORY_SELECT,
  profile: { select: { name: true } },
} as const;

export class ReviewsService {
  /** The hostel behind a slug, if the public may see it at all. */
  private async discoverableHostel(slug: string) {
    const hostel = await prisma.hostels.findFirst({
      // The same visibility predicate as search and detail — a suspended
      // hostel must not keep collecting reviews through a stale link.
      where: { ...DISCOVERABLE, public_slug: slug },
      select: { id: true, name: true, food_included: true },
    });
    if (!hostel) throw ApiError.notFound("This hostel is not listed on Stayo");
    return hostel;
  }

  /** What a visitor sees: published reviews only, newest first, with a summary. */
  async listPublished(slug: string) {
    const hostel = await this.discoverableHostel(slug);

    const reviews = await prisma.hostel_reviews.findMany({
      where: { hostel_id: hostel.id, status: "PUBLISHED" },
      orderBy: { created_at: "desc" },
      take: 50,
      select: PUBLIC_REVIEW_SELECT,
    });

    return {
      summary: summariseReviews(reviews as any),
      /** Which categories this hostel is scored on — food only if it feeds people. */
      categories: categoriesFor(Boolean(hostel.food_included)).map((category) => ({
        key: category.key,
        label: category.label,
      })),
      reviews: reviews.map((review: any) => ({
        id: review.id,
        rating: review.rating,
        body: review.body,
        stayed_here: review.stayed_here,
        created_at: review.created_at,
        author: reviewerDisplayName(review.profile?.name),
        categories: categoriesFor(Boolean(hostel.food_included))
          .map((category) => ({
            key: category.key,
            label: category.label,
            rating: review[category.column] as number | null,
          }))
          .filter((entry) => isValidRating(entry.rating)),
      })),
    };
  }

  /**
   * Whether this person may review this hostel, and why not if they may not.
   *
   * Read by the listing so the box can say the right thing *before* someone
   * writes three paragraphs — being told at submit time that you were never
   * eligible is the worst possible moment to learn it.
   */
  async eligibility(profileId: string | null, slug: string): Promise<ReviewEligibility> {
    if (!profileId) return reviewEligibility({ signedIn: false, tenancyStatuses: [] });

    const hostel = await this.discoverableHostel(slug);
    const tenancies = await prisma.tenants.findMany({
      where: { profile_id: profileId, hostel_id: hostel.id },
      select: { status: true },
    });

    return reviewEligibility({
      signedIn: true,
      tenancyStatuses: tenancies.map((tenancy: any) => String(tenancy.status)),
    });
  }

  /**
   * This visitor's own review, whatever its state — so the box can show them
   * that theirs is with Stayo, or why it was turned down. Without this a
   * submitted review simply vanishes, and the writer assumes it was lost.
   */
  async getMine(profileId: string, slug: string) {
    const hostel = await this.discoverableHostel(slug);
    const mine = await prisma.hostel_reviews.findFirst({
      where: { hostel_id: hostel.id, profile_id: profileId },
      select: {
        id: true,
        rating: true,
        body: true,
        status: true,
        moderation_note: true,
        created_at: true,
      },
    });
    return mine ?? null;
  }

  /**
   * Write or replace this person's review of a hostel.
   *
   * Requires a signed-in profile — the route enforces it, and the unique
   * (hostel, profile) index is what stops one account filing five opinions.
   */
  async submit(
    profile: { id: string },
    slug: string,
    input: { categories?: Record<string, unknown>; body?: unknown },
  ) {
    const hostel = await this.discoverableHostel(slug);

    /**
     * Only people who have lived here. Checked on the server, not merely
     * hidden in the UI — the endpoint is the boundary, and a hidden form is
     * a suggestion.
     */
    const eligibility = await this.eligibility(profile.id, slug);
    if (!eligibility.canReview) {
      throw ApiError.forbidden(
        "Only residents of this hostel can review it — current or former.",
      );
    }

    const categories = categoriesFor(Boolean(hostel.food_included));
    const scores: Record<string, number | null> = {};
    for (const category of categories) {
      const value = (input.categories ?? {})[category.key];
      if (!isValidRating(value)) {
        throw ApiError.validationError(`Rate ${category.label.toLowerCase()} from 1 to 5 stars`);
      }
      scores[category.column] = value;
    }

    // The overall star is derived, never asked for separately: rating the same
    // stay twice invites two different answers and makes the card arbitrary.
    const overall = overallFromCategories(Object.values(scores));
    if (overall == null) throw ApiError.validationError("Rate each category from 1 to 5 stars");

    const body = normaliseReviewBody(input.body);

    /**
     * Has this person ever held a tenancy here? Snapshotted, not joined at
     * read time: a review by someone who lived here stays a review by someone
     * who lived here after they move out. It is a badge and a moderation
     * signal — never a gate, because a visitor who toured the place and was
     * treated badly has something worth saying too.
     */
    const tenancy = await prisma.tenants.findFirst({
      where: { profile_id: profile.id, hostel_id: hostel.id },
      select: { id: true },
    });

    const now = new Date();
    const review = await prisma.hostel_reviews.upsert({
      where: { hostel_id_profile_id: { hostel_id: hostel.id, profile_id: profile.id } },
      create: {
        hostel_id: hostel.id,
        profile_id: profile.id,
        rating: overall,
        ...scores,
        body,
        stayed_here: Boolean(tenancy),
        status: "PENDING",
      },
      update: {
        rating: overall,
        ...scores,
        body,
        stayed_here: Boolean(tenancy),
        // Back to the queue. Approving a review once must not license every
        // later version of it.
        status: "PENDING",
        moderated_at: null,
        moderated_by: null,
        moderation_note: null,
        updated_at: now,
      },
      select: { id: true, status: true, rating: true, body: true, created_at: true },
    });

    return review;
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  /**
   * The moderation queue. Pending first and oldest first — someone is waiting
   * on each of these, and a review that sits unread for a week may as well
   * have been rejected.
   */
  async listForAdmin(status: string = "PENDING") {
    const rows = await prisma.hostel_reviews.findMany({
      where: status === "ALL" ? {} : { status },
      orderBy: [{ created_at: "asc" }],
      take: 200,
      select: {
        id: true,
        rating: true,
        body: true,
        status: true,
        stayed_here: true,
        created_at: true,
        moderated_at: true,
        moderation_note: true,
        ...CATEGORY_SELECT,
        hostel: { select: { id: true, name: true, city: true, public_slug: true, food_included: true } },
        profile: { select: { id: true, name: true, email: true } },
      },
    });

    const counts = await prisma.hostel_reviews.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    return {
      reviews: rows,
      counts: Object.fromEntries(
        counts.map((row: any) => [row.status, row._count._all]),
      ) as Record<string, number>,
    };
  }

  /**
   * Publish or reject one review. This is the only way anything reaches a
   * listing.
   */
  async moderate(
    adminId: string,
    reviewId: string,
    verdict: "PUBLISH" | "REJECT",
    note?: string | null,
  ) {
    const review = await prisma.hostel_reviews.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });
    if (!review) throw ApiError.notFound("Review not found");

    return prisma.hostel_reviews.update({
      where: { id: reviewId },
      data: {
        status: verdict === "PUBLISH" ? "PUBLISHED" : "REJECTED",
        moderated_at: new Date(),
        moderated_by: adminId,
        // A rejection carries its reason; publishing clears any older one.
        moderation_note: verdict === "REJECT" ? (note?.trim() || null) : null,
        updated_at: new Date(),
      },
      select: { id: true, status: true, moderation_note: true },
    });
  }
}

export const reviewsService = new ReviewsService();
