import { describe, it, expect } from "vitest";
import { requiresSessionDespitePublicPrefix } from "@/lib/auth/public-route-exceptions";

const REVIEWS = "/api/discover/hostels/starlink-79ba709b/reviews";

describe("requiresSessionDespitePublicPrefix", () => {
  it("keeps reading a hostel's reviews public", () => {
    expect(requiresSessionDespitePublicPrefix(REVIEWS, "GET")).toBe(false);
    expect(requiresSessionDespitePublicPrefix(REVIEWS, "HEAD")).toBe(false);
  });

  it("makes writing a review authenticated, which the public prefix had broken", () => {
    // The bug: /api/discover/hostels is prefix-matched as public, the public
    // branch strips identity headers, and a signed-in person submitting a
    // review was told to sign in.
    expect(requiresSessionDespitePublicPrefix(REVIEWS, "POST")).toBe(true);
    expect(requiresSessionDespitePublicPrefix(REVIEWS, "post")).toBe(true);
  });

  it("tolerates a trailing slash", () => {
    expect(requiresSessionDespitePublicPrefix(`${REVIEWS}/`, "POST")).toBe(true);
  });

  it("leaves browsing and listing detail alone", () => {
    expect(requiresSessionDespitePublicPrefix("/api/discover/hostels", "GET")).toBe(false);
    expect(requiresSessionDespitePublicPrefix("/api/discover/hostels/abc", "GET")).toBe(false);
    // A hostel whose slug merely contains the word is not the reviews route.
    expect(requiresSessionDespitePublicPrefix("/api/discover/hostels/reviews-hostel", "POST")).toBe(false);
  });

  it("does not claim routes outside the public prefixes", () => {
    expect(requiresSessionDespitePublicPrefix("/api/owner/hostels/abc/marketing", "POST")).toBe(false);
  });
});
