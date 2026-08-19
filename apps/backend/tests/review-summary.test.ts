import { describe, it, expect } from "vitest";
import {
  MIN_REVIEWS_FOR_AVERAGE,
  isValidRating,
  normaliseReviewBody,
  reviewerDisplayName,
  summariseReviews,
} from "@/src/services/discovery/review-summary";

const review = (rating: number, status = "PUBLISHED") => ({ rating, status });

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
