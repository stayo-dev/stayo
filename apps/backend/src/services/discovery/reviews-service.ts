import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";
import {
  categoriesFor,
  formatStayDuration,
  isValidOverall,
  isValidRating,
  monthsBetween,
  normaliseReviewBody,
  reviewerDisplayName,
  REVIEW_CATEGORIES,
  summariseReviews,
} from "./review-summary";
import { detectTopics, type ReviewSentiment } from "./review-categorization";
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
  rating_maintenance: true,
  rating_food: true,
  rating_room_comfort: true,
  rating_amenities: true,
  rating_staff: true,
  rating_safety: true,
  rating_wifi: true,
} as const;

const PUBLIC_REVIEW_SELECT = {
  id: true,
  rating: true,
  body: true,
  stayed_here: true,
  stay_months: true,
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
        stay_duration: formatStayDuration(review.stay_months),
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
        stay_months: true,
      },
    });
    if (!mine) return null;
    return { ...mine, stay_duration: formatStayDuration(mine.stay_months) };
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
    input: { overall?: unknown; categories?: Record<string, unknown>; body?: unknown },
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

    // Overall Experience is its own question, given directly rather than
    // derived from the categories below (ADR-115).
    if (!isValidOverall(input.overall)) {
      throw ApiError.validationError("Rate your overall experience from 1 to 5 stars");
    }
    const overall = input.overall as number;

    const categories = categoriesFor(Boolean(hostel.food_included));
    const scores: Record<string, number | null> = {};
    for (const category of categories) {
      const value = (input.categories ?? {})[category.key];
      if (!isValidRating(value)) {
        throw ApiError.validationError(`Rate ${category.label.toLowerCase()} from 1 to 5 stars`);
      }
      scores[category.column] = value;
    }

    const body = normaliseReviewBody(input.body);

    /**
     * Has this person ever held a tenancy here, and for how long? Snapshotted,
     * not joined at read time: a review by someone who lived here stays a
     * review by someone who lived here after they move out, and the duration
     * describes the stay this review is about rather than drifting with
     * whatever the tenancy record says later. `stayed_here` is a badge and a
     * moderation signal — never a gate, because a visitor who toured the
     * place and was treated badly has something worth saying too.
     */
    const tenancies = await prisma.tenants.findMany({
      where: { profile_id: profile.id, hostel_id: hostel.id },
      select: { status: true, joined_on: true, exit_date: true },
    });
    const now = new Date();
    const activeTenancy = tenancies.find(
      (t: any) => String(t.status).toUpperCase() === "ACTIVE" && t.joined_on,
    );
    const mostRecentFormerTenancy = tenancies
      .filter((t: any) => String(t.status).toUpperCase() === "FORMER_TENANT" && t.joined_on)
      .sort((a: any, b: any) => (b.exit_date?.getTime() ?? 0) - (a.exit_date?.getTime() ?? 0))[0];
    const relevantTenancy = activeTenancy ?? mostRecentFormerTenancy ?? null;
    const stayMonths = relevantTenancy
      ? monthsBetween(new Date(relevantTenancy.joined_on), relevantTenancy.exit_date ?? now)
      : null;

    const topics = detectTopics(body);

    const review = await prisma.$transaction(async (tx: any) => {
      const saved = await tx.hostel_reviews.upsert({
        where: { hostel_id_profile_id: { hostel_id: hostel.id, profile_id: profile.id } },
        create: {
          hostel_id: hostel.id,
          profile_id: profile.id,
          rating: overall,
          ...scores,
          body,
          stayed_here: tenancies.length > 0,
          stay_months: stayMonths,
          status: "PENDING",
        },
        update: {
          rating: overall,
          ...scores,
          body,
          stayed_here: tenancies.length > 0,
          stay_months: stayMonths,
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

      // Replace rather than merge — an edited comment's topics are recomputed
      // from scratch, not accumulated across versions.
      await tx.hostel_review_topics.deleteMany({ where: { review_id: saved.id } });
      if (topics.length > 0) {
        await tx.hostel_review_topics.createMany({
          data: topics.map((topic) => ({
            review_id: saved.id,
            category: topic.category,
            sentiment: topic.sentiment,
            confidence: topic.confidence,
          })),
        });
      }

      return saved;
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
        stay_months: true,
        created_at: true,
        moderated_at: true,
        moderation_note: true,
        ...CATEGORY_SELECT,
        hostel: { select: { id: true, name: true, city: true, public_slug: true, food_included: true } },
        profile: { select: { id: true, name: true, email: true } },
        topics: { select: { category: true, sentiment: true, confidence: true } },
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
   * Publish, reject, or ask for changes on one review. This is the only way
   * anything reaches a listing. `REQUEST_CHANGES` is distinct from `REJECT`
   * (spec's four-state workflow) but both carry a reason the author sees —
   * the review moves back to PENDING itself the moment they edit and resend
   * (see `submit()`), so this verdict is purely a softer word for "not yet".
   */
  async moderate(
    adminId: string,
    reviewId: string,
    verdict: "PUBLISH" | "REJECT" | "REQUEST_CHANGES",
    note?: string | null,
  ) {
    const review = await prisma.hostel_reviews.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });
    if (!review) throw ApiError.notFound("Review not found");

    const status =
      verdict === "PUBLISH" ? "PUBLISHED" : verdict === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";

    return prisma.hostel_reviews.update({
      where: { id: reviewId },
      data: {
        status,
        moderated_at: new Date(),
        moderated_by: adminId,
        // A rejection or a change request carries its reason; publishing
        // clears any older one.
        moderation_note: verdict === "PUBLISH" ? null : note?.trim() || null,
        updated_at: new Date(),
      },
      select: { id: true, status: true, moderation_note: true },
    });
  }

  /**
   * "What are residents talking about" — the admin insights view. Composes
   * the same `hostel_reviews`/`hostel_review_topics` tables the moderation
   * queue reads rather than a parallel aggregation, per topics never
   * gating moderation (ADR-115): this is a read model over data moderation
   * already produced, not a new source of truth.
   */
  async insights(filters: {
    category?: string;
    sentiment?: ReviewSentiment;
    hostelId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const reviewWhere: Record<string, unknown> = {};
    if (filters.hostelId) reviewWhere.hostel_id = filters.hostelId;
    if (filters.status) reviewWhere.status = filters.status;

    const topicWhere: Record<string, unknown> = {};
    if (filters.category) topicWhere.category = filters.category;
    if (filters.sentiment) topicWhere.sentiment = filters.sentiment;
    if (Object.keys(reviewWhere).length > 0) topicWhere.review = reviewWhere;

    const [topics, categoryStats] = await Promise.all([
      prisma.hostel_review_topics.findMany({
        where: topicWhere,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
        select: {
          category: true,
          sentiment: true,
          confidence: true,
          review: {
            select: {
              id: true,
              body: true,
              rating: true,
              status: true,
              created_at: true,
              hostel: { select: { id: true, name: true, public_slug: true } },
              profile: { select: { name: true } },
            },
          },
        },
      }),
      // Per-category mentions/sentiment split — always over every category,
      // independent of the category/sentiment filter above, so the stat
      // cards stay stable while the comment list below them narrows.
      prisma.hostel_review_topics.groupBy({
        by: ["category", "sentiment"],
        where: Object.keys(reviewWhere).length > 0 ? { review: reviewWhere } : {},
        _count: { _all: true },
      }),
    ]);

    const byCategory = new Map<
      string,
      { mentions: number; positive: number; neutral: number; negative: number }
    >();
    for (const row of categoryStats as any[]) {
      const entry = byCategory.get(row.category) ?? {
        mentions: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
      };
      entry.mentions += row._count._all;
      if (row.sentiment === "POSITIVE") entry.positive += row._count._all;
      else if (row.sentiment === "NEGATIVE") entry.negative += row._count._all;
      else entry.neutral += row._count._all;
      byCategory.set(row.category, entry);
    }

    // Average rating per category, from the resident-given stars — a
    // separate query because it reads `hostel_reviews` category columns
    // directly rather than the topics table (topics has no star value).
    const ratingRows = await prisma.hostel_reviews.findMany({
      where: { status: "PUBLISHED", ...(filters.hostelId ? { hostel_id: filters.hostelId } : {}) },
      select: CATEGORY_SELECT,
    });
    const categories = REVIEW_CATEGORIES.map((category) => {
      const values = ratingRows
        .map((row: any) => row[category.column])
        .filter((value: unknown): value is number => isValidRating(value));
      const stats = byCategory.get(category.key) ?? {
        mentions: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
      };
      return {
        key: category.key,
        label: category.label,
        averageRating: values.length
          ? Math.round((values.reduce((total: number, value: number) => total + value, 0) / values.length) * 10) / 10
          : null,
        ...stats,
      };
    });

    return {
      categories,
      comments: (topics as any[]).map((topic) => ({
        category: topic.category,
        sentiment: topic.sentiment,
        confidence: topic.confidence,
        review: {
          id: topic.review.id,
          body: topic.review.body,
          rating: topic.review.rating,
          status: topic.review.status,
          created_at: topic.review.created_at,
          author: reviewerDisplayName(topic.review.profile?.name),
          hostel: topic.review.hostel,
        },
      })),
    };
  }
}

export const reviewsService = new ReviewsService();
