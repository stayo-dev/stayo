/**
 * How a hostel's reviews are summarised and what a visitor is told when there
 * are none.
 *
 * Discovery has shown `ratings_available: false` since it launched, reserving
 * the space rather than inventing a number. The rule that replaces it is the
 * same one: **never state an average that the reviews cannot support.** A
 * single 5★ from one account is not a 5.0 rating, and printing it as one is
 * how a listings site stops being worth reading.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

/**
 * The things residents actually judge a hostel on.
 *
 * Airbnb's six, translated: a hostel is a place you live for a year, so
 * "food" replaces "accuracy" (the mess is the single most argued-about part
 * of hostel life) and "staff" covers the warden and management rather than
 * a host's messaging.
 *
 * `appliesWhenNoFood: false` marks the one category that is not always asked —
 * a hostel that serves no meals cannot be scored on them, and asking anyway
 * produces a number that means nothing.
 */
export const REVIEW_CATEGORIES = [
  { key: "cleanliness", label: "Cleanliness", column: "rating_cleanliness" },
  { key: "food", label: "Food & mess", column: "rating_food", foodOnly: true },
  { key: "safety", label: "Safety", column: "rating_safety" },
  { key: "staff", label: "Staff & support", column: "rating_staff" },
  { key: "value", label: "Value for money", column: "rating_value" },
  { key: "location", label: "Location", column: "rating_location" },
] as const;

export type ReviewCategoryKey = (typeof REVIEW_CATEGORIES)[number]["key"];

/** The categories a given hostel is scored on. */
export function categoriesFor(foodIncluded: boolean) {
  return REVIEW_CATEGORIES.filter((category) => !("foodOnly" in category && category.foodOnly) || foodIncluded);
}

export type ReviewStatus = "PENDING" | "PUBLISHED" | "REJECTED";

export interface ReviewLike {
  rating: number;
  status?: string;
  rating_cleanliness?: number | null;
  rating_food?: number | null;
  rating_safety?: number | null;
  rating_staff?: number | null;
  rating_value?: number | null;
  rating_location?: number | null;
}

export interface ReviewSummary {
  count: number;
  /** Mean to one decimal, or null when there are too few to mean anything. */
  average: number | null;
  /** 5→1, for the distribution bars. */
  distribution: { rating: number; count: number }[];
  /**
   * Per-category means, in the same all-or-nothing spirit as `average`: a
   * category nobody scored is absent rather than zero, and the whole block is
   * withheld until there are enough reviews to average at all.
   */
  categories: { key: ReviewCategoryKey; label: string; average: number; count: number }[];
  /** What the listing says when it cannot show a score. */
  emptyReason: "NONE_YET" | "TOO_FEW" | null;
}

/**
 * Below this, a listing shows the reviews themselves but no average.
 *
 * Two reviews averaging 3.0 tells a reader nothing about a hostel and
 * everything about two people, while carrying all the authority of a number
 * printed next to a star.
 */
export const MIN_REVIEWS_FOR_AVERAGE = 3;

/**
 * The overall score from the categories someone answered.
 *
 * The form asks for categories, not for an overall star on top of them —
 * asking a person to rate the same stay twice invites two different answers
 * and makes the card's number arbitrary. Rounded to a whole star because
 * `rating` is the integer a card renders.
 */
export function overallFromCategories(values: (number | null | undefined)[]): number | null {
  const answered = values.filter((value): value is number => isValidRating(value));
  if (answered.length === 0) return null;
  const mean = answered.reduce((total, value) => total + value, 0) / answered.length;
  return Math.min(5, Math.max(1, Math.round(mean)));
}

export function summariseReviews(reviews: ReviewLike[]): ReviewSummary {
  const published = reviews.filter(
    (review) => review.status === undefined || review.status === "PUBLISHED",
  );
  const ratings = published
    .map((review) => Math.round(Number(review.rating)))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);

  const distribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: ratings.filter((value) => value === rating).length,
  }));

  // Each category averaged over the reviews that actually answered it.
  const categories = REVIEW_CATEGORIES.map((category) => {
    const values = published
      .map((review) => (review as any)[category.column])
      .filter((value: unknown): value is number => isValidRating(value));
    return {
      key: category.key,
      label: category.label,
      count: values.length,
      average: values.length
        ? Math.round((values.reduce((total: number, value: number) => total + value, 0) / values.length) * 10) / 10
        : 0,
    };
  }).filter((category) => category.count > 0);

  if (ratings.length === 0) {
    return { count: 0, average: null, distribution, categories: [], emptyReason: "NONE_YET" };
  }
  if (ratings.length < MIN_REVIEWS_FOR_AVERAGE) {
    // Same rule as the overall score: too few to average is too few per
    // category as well.
    return { count: ratings.length, average: null, distribution, categories: [], emptyReason: "TOO_FEW" };
  }

  const mean = ratings.reduce((total, rating) => total + rating, 0) / ratings.length;
  return {
    count: ratings.length,
    // One decimal: the precision the data supports. 4.33 implies a sample size
    // these listings will not have for a long time.
    average: Math.round(mean * 10) / 10,
    distribution,
    categories,
    emptyReason: null,
  };
}

/** Trimmed, length-capped review text — or null, since a rating alone is valid. */
export function normaliseReviewBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim().replace(/\s+\n/g, "\n").slice(0, 1500);
  return body.length > 0 ? body : null;
}

export function isValidRating(raw: unknown): raw is number {
  // A real number, not a coercible one: this is a type guard, and returning
  // true for "5" would have callers treat a string as a number downstream.
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5;
}

/**
 * How a reviewer is named on a published review.
 *
 * First name plus a last initial: enough that a review reads as a person's
 * rather than an anonymous account, without publishing someone's full name
 * beside an opinion about where they live. Someone with no name on file is
 * "A resident" — never an email or a phone number, which is the failure mode
 * of falling back to "whatever identifier we have".
 */
export function reviewerDisplayName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A resident";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
