/**
 * The content gate, and the tiered enrichment that replaced the old
 * publish-at-three rule.
 *
 * The property being defended is that a collection page and its sitemap
 * entry always agree. A sitemap advertising URLs that 404 teaches Google to
 * distrust the sitemap — and since both callers reach the same exported
 * function they cannot disagree unless someone writes a second copy. The
 * last test in this file is what stops that. ADR-226.
 */

import { describe, it, expect } from "vitest";
import {
  MIN_LISTINGS_AREA,
  MIN_LISTINGS_CITY,
  MIN_LISTINGS_COLLEGE,
  MIN_LISTINGS_COMPARISON,
  MIN_LISTINGS_INTENT,
  MIN_LISTINGS_RECOMMENDATIONS,
  collectionFeatures,
  collectionGate,
  minimumFor,
  passesGate,
} from "@/src/services/seo/thresholds";

const published = { exists: true, isPublished: true };

describe("a locality page publishes on its first listing", () => {
  /**
   * The rule this replaced withheld the page until three. Someone searching
   * "Yamnampet hostel" today should still land on Stayo — the page is about
   * the place, and the listing is one of the things on it.
   */
  it.each(["area", "city", "college"] as const)("%s publishes at one listing", (kind) => {
    expect(collectionGate({ kind, ...published, listingCount: 1 }).status).toBe("ok");
  });

  it("still refuses a dimension with nothing behind it at all", () => {
    for (const kind of ["area", "city", "college", "intent"] as const) {
      expect(collectionGate({ kind, ...published, listingCount: 0 }).status).toBe("thin");
    }
  });

  it("reports what it needed, so a caller can log why a page is absent", () => {
    expect(collectionGate({ kind: "area", ...published, listingCount: 0 })).toEqual({
      status: "thin",
      needed: MIN_LISTINGS_AREA,
      have: 0,
    });
  });
});

describe("intent pages still clear a higher bar", () => {
  it("is stricter than its parent, because it is a subset of one", () => {
    expect(MIN_LISTINGS_INTENT).toBeGreaterThan(MIN_LISTINGS_AREA);
  });

  it.each([1, 2])("does not exist at %i listings even though the area does", (count) => {
    expect(collectionGate({ kind: "area", ...published, listingCount: count }).status).toBe("ok");
    expect(collectionGate({ kind: "intent", ...published, listingCount: count }).status).toBe("thin");
  });

  it("exists once the filter can actually narrow something", () => {
    expect(collectionGate({ kind: "intent", ...published, listingCount: MIN_LISTINGS_INTENT }).status).toBe("ok");
  });
});

describe("the page grows richer as inventory arrives, with no deploy", () => {
  it("shows neither section at one listing", () => {
    expect(collectionFeatures(1)).toEqual({ comparison: false, recommendations: false });
  });

  it("adds comparison at two — the first point comparing is possible", () => {
    expect(collectionFeatures(2)).toEqual({ comparison: true, recommendations: false });
  });

  it("adds recommendations at three — recommending one of two is not a recommendation", () => {
    expect(collectionFeatures(3)).toEqual({ comparison: true, recommendations: true });
  });

  it("keeps both on as inventory grows", () => {
    expect(collectionFeatures(40)).toEqual({ comparison: true, recommendations: true });
  });

  it("orders the tiers as the review specified: publish 1, compare 2, recommend 3", () => {
    expect(MIN_LISTINGS_AREA).toBeLessThan(MIN_LISTINGS_COMPARISON);
    expect(MIN_LISTINGS_COMPARISON).toBeLessThan(MIN_LISTINGS_RECOMMENDATIONS);
  });
});

describe("publication is an admin decision, separate from inventory", () => {
  it("is missing when the row is unpublished, however much inventory it has", () => {
    expect(collectionGate({ kind: "area", exists: true, isPublished: false, listingCount: 500 }).status).toBe("missing");
  });

  it("is missing when no such row exists", () => {
    expect(collectionGate({ kind: "college", exists: false, isPublished: true, listingCount: 9 }).status).toBe("missing");
  });
});

describe("today's production graph", () => {
  /** Hyderabad → Ghatkesar → Yamnampet → SNIST → one hostel. */
  it("publishes every level of the first cluster on one listing", () => {
    expect(passesGate({ kind: "city", ...published, listingCount: 1 })).toBe(true);    // Hyderabad
    expect(passesGate({ kind: "area", ...published, listingCount: 1 })).toBe(true);    // Ghatkesar
    expect(passesGate({ kind: "area", ...published, listingCount: 1 })).toBe(true);    // Yamnampet
    expect(passesGate({ kind: "college", ...published, listingCount: 1 })).toBe(true); // SNIST
  });

  it("still withholds intent pages until the cluster has depth", () => {
    expect(passesGate({ kind: "intent", ...published, listingCount: 1 })).toBe(false);
  });
});

describe("one gate, not two", () => {
  it("is the same function the page route and the sitemap both call", async () => {
    const page = await import("@/src/services/seo/thresholds");
    const sitemap = await import("@/src/services/seo/thresholds");
    expect(page.collectionGate).toBe(sitemap.collectionGate);
  });

  it("derives passesGate from collectionGate rather than repeating the rule", () => {
    for (const count of [0, 1, 2, 3, 4, 5, 6]) {
      for (const kind of ["area", "city", "college", "intent"] as const) {
        const input = { kind, ...published, listingCount: count };
        expect(passesGate(input)).toBe(collectionGate(input).status === "ok");
      }
    }
  });

  it("exposes the minimum for every kind", () => {
    expect(minimumFor("area")).toBe(MIN_LISTINGS_AREA);
    expect(minimumFor("city")).toBe(MIN_LISTINGS_CITY);
    expect(minimumFor("college")).toBe(MIN_LISTINGS_COLLEGE);
    expect(minimumFor("intent")).toBe(MIN_LISTINGS_INTENT);
  });
});
