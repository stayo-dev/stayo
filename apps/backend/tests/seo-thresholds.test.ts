/**
 * The content gate.
 *
 * The property being defended: a collection page and the sitemap entry for
 * that page must agree, always. A sitemap advertising URLs that 404 teaches
 * Google to distrust the sitemap — and since both callers reach the same
 * exported function, they cannot disagree unless someone writes a second copy.
 * The last test in this file is what stops that. ADR-226.
 */

import { describe, it, expect } from "vitest";
import {
  MIN_LISTINGS_AREA,
  MIN_LISTINGS_CITY,
  MIN_LISTINGS_COLLEGE,
  MIN_LISTINGS_INTENT,
  collectionGate,
  minimumFor,
  passesGate,
} from "@/src/services/seo/thresholds";

const published = { exists: true, isPublished: true };

describe("area pages", () => {
  it.each([0, 1, 2])("does not exist at %i listings", (count) => {
    const gate = collectionGate({ kind: "area", ...published, listingCount: count });
    expect(gate.status).toBe("thin");
  });

  it("exists at the threshold", () => {
    expect(collectionGate({ kind: "area", ...published, listingCount: MIN_LISTINGS_AREA }).status).toBe("ok");
  });

  it("reports what it needed, so a caller can log why a page is absent", () => {
    const gate = collectionGate({ kind: "area", ...published, listingCount: 1 });
    expect(gate).toEqual({ status: "thin", needed: MIN_LISTINGS_AREA, have: 1 });
  });
});

describe("intent pages clear a higher bar than their parent", () => {
  it("is stricter than an area, because an intent page is a subset of one", () => {
    expect(MIN_LISTINGS_INTENT).toBeGreaterThan(MIN_LISTINGS_AREA);
  });

  it("does not exist at 4 listings even though an area would", () => {
    expect(collectionGate({ kind: "area", ...published, listingCount: 4 }).status).toBe("ok");
    expect(collectionGate({ kind: "intent", ...published, listingCount: 4 }).status).toBe("thin");
  });

  it("exists at 5", () => {
    expect(collectionGate({ kind: "intent", ...published, listingCount: 5 }).status).toBe("ok");
  });
});

describe("publication is an admin decision, separate from inventory", () => {
  it("is missing when the row is unpublished, however much inventory it has", () => {
    const gate = collectionGate({ kind: "area", exists: true, isPublished: false, listingCount: 500 });
    expect(gate.status).toBe("missing");
  });

  it("is missing when no such row exists", () => {
    const gate = collectionGate({ kind: "college", exists: false, isPublished: true, listingCount: 9 });
    expect(gate.status).toBe("missing");
  });
});

describe("today's production reality", () => {
  /**
   * One discoverable hostel. Every collection page must be absent — this is
   * the assertion that says the engine is safe to deploy before there is
   * inventory to fill it.
   */
  it("emits no collection page at all at one listing", () => {
    for (const kind of ["area", "city", "college", "intent"] as const) {
      expect(passesGate({ kind, ...published, listingCount: 1 })).toBe(false);
    }
  });

  it("opens each kind at its own threshold with no code change", () => {
    expect(passesGate({ kind: "city", ...published, listingCount: MIN_LISTINGS_CITY })).toBe(true);
    expect(passesGate({ kind: "area", ...published, listingCount: MIN_LISTINGS_AREA })).toBe(true);
    expect(passesGate({ kind: "college", ...published, listingCount: MIN_LISTINGS_COLLEGE })).toBe(true);
    expect(passesGate({ kind: "intent", ...published, listingCount: MIN_LISTINGS_INTENT })).toBe(true);
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
