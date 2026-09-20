/**
 * The intent allowlist.
 *
 * The property being defended is that `/hostels-in/:area/:anything` is NOT
 * infinite crawl space. Everything not on the list must 404. ADR-226.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_INTENTS,
  INTENT_SLUGS,
  isKnownIntent,
  resolveIntent,
  resolveIntentSegments,
} from "@/src/services/seo/intents";

describe("the list is closed", () => {
  it.each([
    "anything",
    "BOYS",
    "boys-hostels",
    "under-7999",
    "../../etc/passwd",
    "%2e%2e",
    "",
    "girls ",
  ])("rejects %j", (slug) => {
    // Note: `resolveIntent` lowercases and trims, so "BOYS" and "girls " DO
    // resolve — asserted separately below. Everything else must not.
    const known = isKnownIntent(slug);
    if (slug.trim().toLowerCase() === "boys" || slug.trim().toLowerCase() === "girls") {
      expect(known).toBe(true);
    } else {
      expect(known).toBe(false);
    }
  });

  it("accepts a known intent case-insensitively rather than 404ing a capital", () => {
    expect(resolveIntent("BOYS")?.slug).toBe("boys");
    expect(resolveIntent(" girls ")?.slug).toBe("girls");
  });

  it("returns null, not a default, for an unknown segment", () => {
    expect(resolveIntent("student")).toBeNull();
    expect(resolveIntent(null)).toBeNull();
    expect(resolveIntent(undefined)).toBeNull();
  });
});

describe("one intent per page, or none", () => {
  it("resolves a single segment", () => {
    expect(resolveIntentSegments(["boys"])?.slug).toBe("boys");
  });

  it("refuses stacked intents — /yamnampet/boys/under-8000 is not a page", () => {
    expect(resolveIntentSegments(["boys", "under-8000"])).toBeNull();
  });

  it("treats no segment as the unfiltered collection", () => {
    expect(resolveIntentSegments([])).toBeNull();
    expect(resolveIntentSegments(undefined)).toBeNull();
  });
});

describe("every intent maps onto a filter discovery already supports", () => {
  it("defines a non-empty filter for each", () => {
    for (const intent of ALL_INTENTS) {
      expect(Object.keys(intent.filters).length).toBeGreaterThan(0);
    }
  });

  it("only uses known DiscoverSearchParams keys", () => {
    const allowed = new Set([
      "q", "city", "minPrice", "maxPrice", "sharing",
      "hostelType", "foodIncluded", "hasVacancy", "sort", "limit", "offset",
    ]);
    for (const intent of ALL_INTENTS) {
      for (const key of Object.keys(intent.filters)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it("uses only real hostel_type values", () => {
    const valid = new Set(["BOYS", "GIRLS", "CO_LIVING", "WORKING_PROS"]);
    for (const intent of ALL_INTENTS) {
      if (intent.filters.hostelType) {
        expect(valid.has(intent.filters.hostelType)).toBe(true);
      }
    }
  });
});

describe("the slugs themselves", () => {
  it("are unique", () => {
    expect(new Set(INTENT_SLUGS).size).toBe(INTENT_SLUGS.length);
  });

  it("are URL-safe and already lowercase", () => {
    for (const slug of INTENT_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("carry a label and a phrase for every one, so no page renders a bare slug", () => {
    for (const intent of ALL_INTENTS) {
      expect(intent.label.trim().length).toBeGreaterThan(0);
      expect(intent.phrase.trim().length).toBeGreaterThan(0);
      expect(intent.label).not.toBe(intent.slug);
    }
  });

  it("covers the searches ADR-226 set out to win", () => {
    for (const slug of ["boys", "girls", "with-food", "4-sharing", "under-8000"]) {
      expect(INTENT_SLUGS).toContain(slug);
    }
  });
});
