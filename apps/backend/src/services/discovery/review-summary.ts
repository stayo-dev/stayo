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
 * The things residents actually judge a hostel on (migration 076).
 *
 * Hostel-specific, not Airbnb's holiday-flat categories: a resident lives
 * here for a year and never once cares about "listing accuracy" or
 * "location" the way a two-night guest does. Eight categories, each its own
 * 1–5 question — never averaged into the overall star, which the resident
 * gives separately (see `isValidOverall`).
 *
 * `foodOnly: true` marks the one category that is not always asked — a
 * hostel that serves no meals cannot be scored on them, and asking anyway
 * produces a number that means nothing.
 */
export const REVIEW_CATEGORIES = [
  { key: "cleanliness", label: "Cleanliness", column: "rating_cleanliness" },
  { key: "maintenance", label: "Maintenance", column: "rating_maintenance" },
  { key: "food", label: "Food", column: "rating_food", foodOnly: true },
  { key: "room_comfort", label: "Room Comfort", column: "rating_room_comfort" },
  { key: "amenities", label: "Amenities", column: "rating_amenities" },
  { key: "staff", label: "Staff & Management", column: "rating_staff" },
  { key: "safety", label: "Safety", column: "rating_safety" },
  { key: "wifi", label: "Wi-Fi", column: "rating_wifi" },
] as const;

export type ReviewCategoryKey = (typeof REVIEW_CATEGORIES)[number]["key"];

/** The categories a given hostel is scored on. */
export function categoriesFor(foodIncluded: boolean) {
  return REVIEW_CATEGORIES.filter((category) => !("foodOnly" in category && category.foodOnly) || foodIncluded);
}

export type ReviewStatus = "PENDING" | "PUBLISHED" | "REJECTED" | "CHANGES_REQUESTED";

export interface ReviewLike {
  rating: number;
  status?: string;
  rating_cleanliness?: number | null;
  rating_maintenance?: number | null;
  rating_food?: number | null;
  rating_room_comfort?: number | null;
  rating_amenities?: number | null;
  rating_staff?: number | null;
  rating_safety?: number | null;
  rating_wifi?: number | null;
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
  /** Whether this hostel earns Stayo's "Resident Favourite" label. */
  isResidentFavourite: boolean;
  /** Top positive tags mentioned across published reviews, most-common first. */
  highlights: { label: string; count: number }[];
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
 * The overall star, validated on its own terms.
 *
 * Given directly by the resident as its own question (migration 076), not
 * derived from the eight categories — an alias for `isValidRating` kept
 * distinct so call sites read as validating the standalone field, not a
 * category.
 */
export const isValidOverall = isValidRating;

/**
 * A snapshotted stay, in words. "Stayed 6 months" / "Stayed 2 years" — never
 * "Stayed 14 months", because nobody reads a stay in fractions of a year
 * once it is over one.
 */
export function formatStayDuration(months: number | null | undefined): string | null {
  if (months == null || !Number.isFinite(months) || months <= 0) return null;
  if (months < 24) return `Stayed ${months} month${months === 1 ? "" : "s"}`;
  const years = Math.round(months / 12);
  return `Stayed ${years} year${years === 1 ? "" : "s"}`;
}

/**
 * Whole months between two dates, floored — a stay that started and ended
 * within the same calendar month is 0, not 1.
 */
export function monthsBetween(start: Date, end: Date): number {
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return end.getDate() < start.getDate() ? Math.max(0, months - 1) : Math.max(0, months);
}

/**
 * Stayo's own equivalent of "Guest favourite" — never Airbnb's wreath, but
 * the same idea: a small badge that only fires once the average can be
 * trusted (see `MIN_REVIEWS_FOR_AVERAGE`) and is genuinely high.
 */
export function isResidentFavourite(average: number | null, count: number): boolean {
  return average != null && average >= 4.5 && count >= 5;
}

/**
 * Friendly tag for a category rated highly on one review — "Cleanliness: 5"
 * tells a browsing reader nothing; "Clean Rooms" does. Only categories rated
 * 4 or 5 earn a tag; a mediocre score is not a highlight.
 */
const HIGHLIGHT_LABELS: Record<ReviewCategoryKey, string> = {
  cleanliness: "Clean Rooms",
  maintenance: "Well Maintained",
  food: "Good Food",
  room_comfort: "Comfortable Rooms",
  amenities: "Good Amenities",
  staff: "Helpful Staff",
  safety: "Safe Environment",
  wifi: "Good Wi-Fi",
};

const HIGHLIGHT_THRESHOLD = 4;

/**
 * The tags shown under a hostel's rating — "Residents mention" — tallied
 * across every published review rather than resident-picked, per the rule
 * that a tag is *derived*, not another form field to fill in.
 */
export function deriveHighlights(reviews: ReviewLike[]): { label: string; count: number }[] {
  const published = reviews.filter(
    (review) => review.status === undefined || review.status === "PUBLISHED",
  );
  const counts = new Map<string, number>();
  for (const review of published) {
    for (const category of REVIEW_CATEGORIES) {
      const value = (review as any)[category.column];
      if (isValidRating(value) && value >= HIGHLIGHT_THRESHOLD) {
        const label = HIGHLIGHT_LABELS[category.key];
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
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
    return {
      count: 0,
      average: null,
      distribution,
      categories: [],
      emptyReason: "NONE_YET",
      isResidentFavourite: false,
      highlights: [],
    };
  }
  if (ratings.length < MIN_REVIEWS_FOR_AVERAGE) {
    // Same rule as the overall score: too few to average is too few per
    // category (and highlights) as well.
    return {
      count: ratings.length,
      average: null,
      distribution,
      categories: [],
      emptyReason: "TOO_FEW",
      isResidentFavourite: false,
      highlights: [],
    };
  }

  const mean = ratings.reduce((total, rating) => total + rating, 0) / ratings.length;
  // One decimal: the precision the data supports. 4.33 implies a sample size
  // these listings will not have for a long time.
  const average = Math.round(mean * 10) / 10;
  return {
    count: ratings.length,
    average,
    distribution,
    categories,
    emptyReason: null,
    isResidentFavourite: isResidentFavourite(average, ratings.length),
    highlights: deriveHighlights(published),
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
