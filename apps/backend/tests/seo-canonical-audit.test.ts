import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { hostelUrl, areaUrl, collegeUrl, hubUrl, siteUrl } from "@/src/services/seo/seo-links";
import { hostelPageSpec, collectionPageSpec, summariseListings } from "@/src/services/seo/page-spec";
import { resolveIntent } from "@/src/services/seo/intents";
import type { CollectionSubject, HostelFacts, ListingCardFact } from "@/src/services/seo/types";

/**
 * Canonical consistency audit.
 *
 * A canonical is the single most dangerous tag on an indexable page: one that
 * points at the wrong URL silently merges two pages, and one that is relative
 * or missing hands Google the decision. This asserts the properties that must
 * hold for EVERY page kind, rather than for one example. ADR-226.
 */

const SEO_ROUTES = path.resolve(__dirname, "../app/(seo)");

function facts(overrides: Partial<HostelFacts> = {}): HostelFacts {
  return {
    id: "36094ab4", slug: "sri-adithya-boys-hostel-yamnampet-36094ab4", name: "Sri Adithya Boys Hostel",
    areaName: "Yamnampet", areaSlug: "yamnampet", parentAreaName: "Ghatkesar", parentAreaSlug: "ghatkesar",
    cityAreaSlug: "hyderabad",
    areaAncestry: [
      { name: "Yamnampet", slug: "yamnampet", kind: "LOCALITY", published: true },
      { name: "Ghatkesar", slug: "ghatkesar", kind: "LOCALITY", published: true },
      { name: "Hyderabad", slug: "hyderabad", kind: "CITY", published: true },
    ],
    city: "Hyderabad", state: "Telangana", address: "Yamnampet",
    hostelType: "BOYS", foodIncluded: false, verified: true,
    startingPrice: 8200, sharing: [1, 2, 4], bedTiers: [], tagline: null, about: null,
    highlights: [], amenities: [], photos: [], vacantBeds: 107,
    availabilityConfirmed: true, platformListed: false,
    colleges: [], places: [], mess: null, host: null, navigation: null,
    reviewCount: 0, rating: null, reviews: [], updatedAt: null,
    ...overrides,
  };
}

const card: ListingCardFact = {
  slug: "a-1111aaaa", name: "A", areaName: "Yamnampet", city: "Hyderabad", hostelType: "BOYS",
  startingPrice: 8200, sharing: [4], foodIncluded: false, photo: null,
  vacantBeds: 3, availabilityConfirmed: true,
};

function specs() {
  const stats = summariseListings([card]);
  const area: CollectionSubject = { kind: "area", slug: "yamnampet", name: "Yamnampet", intro: null, parentName: "Ghatkesar", parentSlug: "ghatkesar" };
  const city: CollectionSubject = { kind: "city", slug: "hyderabad", name: "Hyderabad", intro: null };
  const college: CollectionSubject = { kind: "college", slug: "snist", name: "Sreenidhi", shortName: "SNIST", intro: null };

  return [
    { label: "hostel", spec: hostelPageSpec({ facts: facts() }), expected: hostelUrl("sri-adithya-boys-hostel-yamnampet-36094ab4") },
    { label: "area", spec: collectionPageSpec({ subject: area, stats, listings: [card], intent: null }), expected: areaUrl("yamnampet") },
    { label: "city", spec: collectionPageSpec({ subject: city, stats, listings: [card], intent: null }), expected: areaUrl("hyderabad") },
    { label: "college", spec: collectionPageSpec({ subject: college, stats, listings: [card], intent: null }), expected: collegeUrl("snist") },
    { label: "area+intent", spec: collectionPageSpec({ subject: area, stats, listings: [card], intent: resolveIntent("boys") }), expected: areaUrl("yamnampet", "boys") },
    { label: "college+intent", spec: collectionPageSpec({ subject: college, stats, listings: [card], intent: resolveIntent("girls") }), expected: collegeUrl("snist", "girls") },
  ];
}

describe("every page kind declares a canonical", () => {
  it.each(specs().map((s) => [s.label] as const))("%s has a non-empty canonical", (label) => {
    const entry = specs().find((s) => s.label === label)!;
    expect(entry.spec.canonicalUrl.trim().length).toBeGreaterThan(0);
  });

  it.each(specs().map((s) => [s.label] as const))("%s's canonical matches its own route", (label) => {
    const entry = specs().find((s) => s.label === label)!;
    expect(entry.spec.canonicalUrl).toBe(entry.expected);
  });
});

describe("canonicals are absolute and on the public origin", () => {
  it.each(specs().map((s) => [s.label] as const))("%s is absolute https", (label) => {
    const entry = specs().find((s) => s.label === label)!;
    expect(entry.spec.canonicalUrl.startsWith("https://")).toBe(true);
  });

  it("never points at the backend host, which is where these actually render", () => {
    for (const { spec } of specs()) {
      expect(spec.canonicalUrl).not.toContain("api.yourstayo.com");
      expect(spec.canonicalUrl.startsWith(siteUrl())).toBe(true);
    }
  });

  it("carries no trailing slash, query or fragment", () => {
    for (const { spec } of specs()) {
      const url = new URL(spec.canonicalUrl);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.pathname.endsWith("/")).toBe(false);
    }
  });

  it("is lowercase — one hostel must not be two indexable addresses", () => {
    for (const { spec } of specs()) {
      const { pathname } = new URL(spec.canonicalUrl);
      expect(pathname).toBe(pathname.toLowerCase());
    }
  });
});

describe("no two page kinds claim the same canonical", () => {
  it("is unique across every kind and intent variant", () => {
    const urls = specs().map((s) => s.spec.canonicalUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("gives an intent page its own address, not its parent's", () => {
    const [, area] = specs();
    const withIntent = specs().find((s) => s.label === "area+intent")!;
    expect(withIntent.spec.canonicalUrl).not.toBe(area.spec.canonicalUrl);
  });
});

describe("indexable routes declare their canonical through the generator", () => {
  /**
   * Reads the route files as text. The failure this prevents: a new page
   * added later that renders fine, is crawlable, and quietly has no canonical
   * — or hardcodes one, which is how a canonical comes to point at a stale
   * path after a URL shape changes.
   */
  function routeFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...routeFiles(full));
      else if (entry.name === "page.tsx") out.push(full);
    }
    return out;
  }

  const pages = routeFiles(SEO_ROUTES);

  it("finds every indexable route", () => {
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  it.each(pages.map((p) => [path.relative(SEO_ROUTES, p)] as const))(
    "%s sets alternates.canonical",
    (relative) => {
      const source = fs.readFileSync(path.join(SEO_ROUTES, relative), "utf8");
      expect(source).toMatch(/alternates:\s*\{\s*canonical/);
    },
  );

  it.each(pages.map((p) => [path.relative(SEO_ROUTES, p)] as const))(
    "%s builds its canonical from the generator, never a literal",
    (relative) => {
      const source = fs.readFileSync(path.join(SEO_ROUTES, relative), "utf8");
      // A hardcoded https:// inside the metadata block is the smell: it
      // survives a URL-shape change that the generator would have absorbed.
      const metadata = source.slice(source.indexOf("generateMetadata"), source.indexOf("export default"));
      expect(metadata).not.toMatch(/canonical:\s*["'`]https?:\/\//);
    },
  );
});

describe("the hub", () => {
  it("is self-canonical", () => {
    const source = fs.readFileSync(path.join(SEO_ROUTES, "hostels/page.tsx"), "utf8");
    expect(source).toContain("canonical: hubUrl()");
  });
});
