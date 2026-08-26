import { describe, it, expect } from "vitest";
import {
  deriveHighlights,
  formatStayDuration,
  isResidentFavourite,
  isValidOverall,
  isValidRating,
  MIN_REVIEWS_FOR_AVERAGE,
  monthsBetween,
  normaliseReviewBody,
  REVIEW_CATEGORIES,
  reviewerDisplayName,
  summariseReviews,
} from "@/src/services/discovery/review-summary";

const review = (rating: number, status = "PUBLISHED", extra: Record<string, unknown> = {}) => ({
  rating,
  status,
  ...extra,
});

describe("summariseReviews", () => {
  it("says there is nothing yet rather than showing a zero", () => {
    const summary = summariseReviews([]);
    expect(summary.count).toBe(0);
    expect(summary.average).toBeNull();
    expect(summary.emptyReason).toBe("NONE_YET");
  });

  it("refuses to average one or two reviews", () => {
    // Two reviews averaging 3.0 says nothing about a hostel and everything
    // about two people, while carrying the authority of a number by a star.
    const summary = summariseReviews([review(5), review(1)]);
    expect(summary.count).toBe(2);
    expect(summary.average).toBeNull();
    expect(summary.emptyReason).toBe("TOO_FEW");
  });

  it("averages once there are enough, to one decimal", () => {
    const summary = summariseReviews([review(5), review(4), review(4)]);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(4.3);
    expect(summary.emptyReason).toBeNull();
  });

  it("counts only published reviews", () => {
    const summary = summariseReviews([
      review(5),
      review(5),
      review(5),
      review(1, "PENDING"),
      review(1, "REJECTED"),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.average).toBe(5);
  });

  it("builds a 5-to-1 distribution", () => {
    const summary = summariseReviews([review(5), review(5), review(3)]);
    expect(summary.distribution).toEqual([
      { rating: 5, count: 2 },
      { rating: 4, count: 0 },
      { rating: 3, count: 1 },
      { rating: 2, count: 0 },
      { rating: 1, count: 0 },
    ]);
  });

  it("ignores ratings outside the scale rather than skewing the mean", () => {
    const summary = summariseReviews([review(5), review(4), review(4), review(9), review(0)]);
    expect(summary.count).toBe(3);
  });

  it("needs three, and three is the documented threshold", () => {
    expect(MIN_REVIEWS_FOR_AVERAGE).toBe(3);
    expect(summariseReviews(Array(MIN_REVIEWS_FOR_AVERAGE).fill(review(4))).average).toBe(4);
  });
});

describe("normaliseReviewBody", () => {
  it("keeps trimmed text and drops empty text", () => {
    expect(normaliseReviewBody("  Clean rooms, good food  ")).toBe("Clean rooms, good food");
    expect(normaliseReviewBody("   ")).toBeNull();
    expect(normaliseReviewBody(undefined)).toBeNull();
    expect(normaliseReviewBody(42)).toBeNull();
  });

  it("caps a very long review", () => {
    expect(normaliseReviewBody("x".repeat(3000))!.length).toBe(1500);
  });
});

describe("isValidRating", () => {
  it("takes 1 to 5 whole stars only", () => {
    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(5)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
    expect(isValidRating("5")).toBe(false);
  });
});

describe("reviewerDisplayName", () => {
  it("publishes a first name and a last initial", () => {
    expect(reviewerDisplayName("Sharan Kumar")).toBe("Sharan K.");
    expect(reviewerDisplayName("Sharan")).toBe("Sharan");
  });

  it("never falls back to an email or a phone number", () => {
    // The failure mode of "use whatever identifier we have" is publishing
    // someone's email beside an opinion about where they live.
    expect(reviewerDisplayName(null)).toBe("A resident");
    expect(reviewerDisplayName("   ")).toBe("A resident");
  });
});

describe("REVIEW_CATEGORIES", () => {
  it("is the seven hostel-specific categories, not Airbnb's six", () => {
    expect(REVIEW_CATEGORIES.map((category) => category.key)).toEqual([
      "cleanliness",
      "maintenance",
      "food",
      "room_comfort",
      "staff",
      "safety",
      "wifi",
    ]);
    // Value and Location were dropped — a hostel is not a holiday flat.
    expect(REVIEW_CATEGORIES.some((category) => category.key === "value")).toBe(false);
    expect(REVIEW_CATEGORIES.some((category) => category.key === "location")).toBe(false);
    // Amenities was dropped as a rating question too.
    expect(REVIEW_CATEGORIES.some((category) => category.key === "amenities")).toBe(false);
  });

  it("only Food is conditional on the hostel serving meals", () => {
    const foodOnly = REVIEW_CATEGORIES.filter((category: any) => category.foodOnly);
    expect(foodOnly.map((category) => category.key)).toEqual(["food"]);
  });
});

describe("isValidOverall", () => {
  it("is the same 1-to-5 rule as isValidRating", () => {
    expect(isValidOverall(4)).toBe(true);
    expect(isValidOverall(0)).toBe(false);
    expect(isValidOverall(undefined)).toBe(false);
  });
});

describe("monthsBetween", () => {
  it("counts whole months, floored", () => {
    expect(monthsBetween(new Date("2026-01-15"), new Date("2026-07-15"))).toBe(6);
    expect(monthsBetween(new Date("2026-01-15"), new Date("2026-07-10"))).toBe(5);
    expect(monthsBetween(new Date("2026-01-15"), new Date("2026-01-20"))).toBe(0);
  });

  it("never goes negative", () => {
    expect(monthsBetween(new Date("2026-07-01"), new Date("2026-01-01"))).toBe(0);
  });
});

describe("formatStayDuration", () => {
  it("reads in months under two years, and years beyond that", () => {
    expect(formatStayDuration(1)).toBe("Stayed 1 month");
    expect(formatStayDuration(6)).toBe("Stayed 6 months");
    expect(formatStayDuration(23)).toBe("Stayed 23 months");
    expect(formatStayDuration(24)).toBe("Stayed 2 years");
    expect(formatStayDuration(13)).toBe("Stayed 13 months");
  });

  it("is null for no snapshot", () => {
    expect(formatStayDuration(null)).toBeNull();
    expect(formatStayDuration(undefined)).toBeNull();
    expect(formatStayDuration(0)).toBeNull();
  });
});

describe("isResidentFavourite", () => {
  it("needs a high average and enough reviews to back it", () => {
    expect(isResidentFavourite(4.8, 10)).toBe(true);
    expect(isResidentFavourite(4.8, 4)).toBe(false);
    expect(isResidentFavourite(4.2, 10)).toBe(false);
    expect(isResidentFavourite(null, 10)).toBe(false);
  });
});

describe("deriveHighlights", () => {
  it("tags only categories rated 4 or 5, not a mediocre score", () => {
    const highlights = deriveHighlights([
      review(5, "PUBLISHED", { rating_cleanliness: 5, rating_wifi: 2 }),
      review(4, "PUBLISHED", { rating_cleanliness: 4, rating_staff: 5 }),
    ]);
    expect(highlights).toEqual([
      { label: "Clean Rooms", count: 2 },
      { label: "Helpful Staff", count: 1 },
    ]);
  });

  it("ignores pending and rejected reviews", () => {
    const highlights = deriveHighlights([
      review(5, "PENDING", { rating_cleanliness: 5 }),
      review(5, "REJECTED", { rating_cleanliness: 5 }),
    ]);
    expect(highlights).toEqual([]);
  });
});

describe("summariseReviews — favourite label and highlights", () => {
  it("only awards Resident Favourite once the average is trustworthy and high", () => {
    const strong = summariseReviews(
      Array(5).fill(review(5, "PUBLISHED", { rating_cleanliness: 5 })),
    );
    expect(strong.isResidentFavourite).toBe(true);
    expect(strong.highlights).toEqual([{ label: "Clean Rooms", count: 5 }]);

    const mediocre = summariseReviews(Array(5).fill(review(3, "PUBLISHED")));
    expect(mediocre.isResidentFavourite).toBe(false);

    const tooFew = summariseReviews(Array(2).fill(review(5, "PUBLISHED", { rating_cleanliness: 5 })));
    expect(tooFew.isResidentFavourite).toBe(false);
    expect(tooFew.highlights).toEqual([]);
  });
});
