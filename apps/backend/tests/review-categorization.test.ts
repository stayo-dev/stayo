import { describe, it, expect } from "vitest";
import { detectTopics } from "@/src/services/discovery/review-categorization";

describe("detectTopics", () => {
  it("finds nothing in an empty comment", () => {
    expect(detectTopics(null)).toEqual([]);
    expect(detectTopics(undefined)).toEqual([]);
    expect(detectTopics("   ")).toEqual([]);
  });

  it("detects a single category and its sentiment", () => {
    const topics = detectTopics("The Wi-Fi is extremely slow after 8 PM.");
    expect(topics).toHaveLength(1);
    expect(topics[0].category).toBe("wifi");
    expect(topics[0].sentiment).toBe("NEGATIVE");
    expect(topics[0].confidence).toBeGreaterThan(0);
  });

  it("splits a comment into multiple topics with independent sentiment", () => {
    const topics = detectTopics(
      "The room is clean and comfortable, but the Wi-Fi is very slow at night and the food has limited variety.",
    );
    const byCategory = Object.fromEntries(topics.map((t) => [t.category, t.sentiment]));
    expect(byCategory.cleanliness).toBe("POSITIVE");
    expect(byCategory.room_comfort).toBe("POSITIVE");
    expect(byCategory.wifi).toBe("NEGATIVE");
    expect(byCategory.food).toBeDefined();
  });

  it("reads neutral when a topic is mentioned with no sentiment words", () => {
    const topics = detectTopics("There is Wi-Fi in the building.");
    expect(topics.find((t) => t.category === "wifi")?.sentiment).toBe("NEUTRAL");
  });

  it("never lets a negative comment imply anything about publication", () => {
    // detectTopics only classifies; it must not throw, reject, or otherwise
    // gate on how negative the comment is. See ADR-115.
    const topics = detectTopics(
      "This is the worst, filthiest, most unsafe place I have ever lived. Terrible staff.",
    );
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.every((t) => typeof t.confidence === "number")).toBe(true);
  });

  it("caps confidence at 1", () => {
    const topics = detectTopics(
      "Excellent, great, amazing, wonderful, superb cleanliness, clean, spotless, best rooms ever.",
    );
    const cleanliness = topics.find((t) => t.category === "cleanliness");
    expect(cleanliness?.confidence).toBeLessThanOrEqual(1);
  });
});
