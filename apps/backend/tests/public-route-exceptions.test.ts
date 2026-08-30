import { describe, it, expect } from "vitest";
import {
  allowsOptionalIdentity,
  requiresSessionDespitePublicPrefix,
} from "@/lib/auth/public-route-exceptions";

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

describe('allowsOptionalIdentity — public, but knows who is asking', () => {
  const path = '/api/discover/hostels/sunrise-residency/reviews';

  // The bug: a signed-in resident was told "Sign in to write a review" while
  // holding a good session, because the public branch strips identity headers.
  it('marks GET reviews as identity-optional', () => {
    expect(allowsOptionalIdentity(path, 'GET')).toBe(true);
    expect(allowsOptionalIdentity(path + '/', 'GET')).toBe(true);
  });

  // Writing is the other exception's job — it must *require* a session, not
  // merely accept one.
  it('leaves writes to requiresSessionDespitePublicPrefix', () => {
    for (const verb of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(allowsOptionalIdentity(path, verb)).toBe(false);
      expect(requiresSessionDespitePublicPrefix(path, verb)).toBe(true);
    }
    expect(requiresSessionDespitePublicPrefix(path, 'GET')).toBe(false);
  });

  it('does not leak to neighbouring discover paths', () => {
    expect(allowsOptionalIdentity('/api/discover/hostels/sunrise-residency', 'GET')).toBe(false);
    expect(allowsOptionalIdentity('/api/discover/enquiries', 'GET')).toBe(false);
    expect(allowsOptionalIdentity('/api/discover/saved', 'GET')).toBe(false);
    expect(allowsOptionalIdentity('/api/discover/hostels/a/reviews/b', 'GET')).toBe(false);
  });

  it('is case-insensitive about the verb and safe on junk input', () => {
    expect(allowsOptionalIdentity(path, 'get')).toBe(true);
    expect(allowsOptionalIdentity(path, '')).toBe(false);
    expect(allowsOptionalIdentity('', 'GET')).toBe(false);
  });
});
