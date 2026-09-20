/**
 * The generator: one spec type, four page kinds, all driven by data.
 *
 * The canonical assertions here are the important ones. A canonical that is
 * relative, or that points at another page, is how a site asks Google to merge
 * pages it wanted kept apart. ADR-224.
 */

import { describe, it, expect } from "vitest";
import { collectionPageSpec, hostelPageSpec, summariseListings } from "@/src/services/seo/page-spec";
import { resolveIntent } from "@/src/services/seo/intents";
import type { CollectionSubject, HostelFacts, ListingCardFact } from "@/src/services/seo/types";

function facts(overrides: Partial<HostelFacts> = {}): HostelFacts {
  return {
    id: "36094ab4",
    slug: "sri-adithya-boys-hostel-yamnampet-36094ab4",
    name: "Sri Adithya Boys Hostel",
    areaName: "Yamnampet",
    areaSlug: "yamnampet",
    city: "Hyderabad",
    state: "Telangana",
    address: "Yamnampet",
    hostelType: "BOYS",
    foodIncluded: false,
    verified: true,
    startingPrice: 8200,
    sharing: [1, 2, 4],
    bedTiers: [{ name: "4-sharing", sharing: 4, price: 8200, availability: "AVAILABLE", space: null }],
    tagline: null,
    about: null,
    highlights: [],
    amenities: [],
    photos: ["https://ik.imagekit.io/x/cover.jpg"],
    vacantBeds: 107,
    availabilityConfirmed: true,
    platformListed: false,
    colleges: [{ name: "Sreenidhi", shortName: "SNIST", slug: "snist", distanceText: "400 m" }],
    places: [],
    mess: null,
    host: null,
    navigation: null,
    reviewCount: 0,
    rating: null,
    reviews: [],
    updatedAt: null,
    ...overrides,
  };
}

function card(overrides: Partial<ListingCardFact> = {}): ListingCardFact {
  return {
    slug: "other-hostel-yamnampet-1111aaaa",
    name: "Other Hostel",
    areaName: "Yamnampet",
    city: "Hyderabad",
    hostelType: "BOYS",
    startingPrice: 7000,
    sharing: [4],
    foodIncluded: true,
    photo: "https://ik.imagekit.io/x/o.jpg",
    vacantBeds: 2,
    availabilityConfirmed: true,
    ...overrides,
  };
}

describe("hostel page", () => {
  it("is self-canonical, absolute, and on the public origin", () => {
    const spec = hostelPageSpec({ facts: facts() });
    expect(spec.canonicalUrl).toBe(
      "https://yourstayo.com/hostels/sri-adithya-boys-hostel-yamnampet-36094ab4",
    );
    expect(spec.canonicalUrl.startsWith("https://")).toBe(true);
    expect(spec.canonicalUrl).not.toContain("api.yourstayo.com");
  });

  it("asks to be indexed", () => {
    expect(hostelPageSpec({ facts: facts() }).robots).toEqual({ index: true, follow: true });
  });

  it("carries exactly the hostel node and a breadcrumb trail", () => {
    const spec = hostelPageSpec({ facts: facts() });
    const types = spec.jsonLd.map((node: any) => node["@type"]);
    expect(types).toEqual(["Hostel", "BreadcrumbList"]);
  });

  it("ends its breadcrumb trail on itself", () => {
    const spec = hostelPageSpec({ facts: facts() });
    expect(spec.breadcrumbs.at(-1)).toEqual({
      name: "Sri Adithya Boys Hostel",
      url: spec.canonicalUrl,
    });
  });

  it("does not link to an area page that has not passed its threshold", () => {
    const spec = hostelPageSpec({ facts: facts(), areaIsPublished: false });
    expect(spec.links.parents.some((link) => link.href.includes("/hostels-in/"))).toBe(false);
    expect(spec.breadcrumbs.some((crumb) => crumb.url.includes("/hostels-in/"))).toBe(false);
  });

  it("links to the area page once it has", () => {
    const spec = hostelPageSpec({ facts: facts(), areaIsPublished: true });
    expect(spec.links.parents[0]).toEqual({
      href: "https://yourstayo.com/hostels-in/yamnampet",
      label: "Hostels in Yamnampet",
    });
  });

  it("names its nearest college in copy even before that page exists", () => {
    const spec = hostelPageSpec({ facts: facts() });
    expect(spec.description).toContain("SNIST");
    expect(spec.links.parents.some((link) => link.href.includes("/hostels-near/"))).toBe(false);
  });

  it("links to a college page only once that page passes its own gate", () => {
    const spec = hostelPageSpec({ facts: facts(), publishedCollegeSlugs: ["snist"] });
    expect(spec.links.parents).toContainEqual({
      href: "https://yourstayo.com/hostels-near/snist",
      label: "Hostels near SNIST",
    });
  });

  it("never links to itself as a sibling", () => {
    const spec = hostelPageSpec({
      facts: facts(),
      nearbyInArea: [card({ slug: "sri-adithya-boys-hostel-yamnampet-36094ab4", name: "Itself" })],
    });
    expect(spec.links.siblings).toHaveLength(0);
  });

  it("does not list the same hostel twice when it is both an area and a college neighbour", () => {
    const shared = card();
    const spec = hostelPageSpec({
      facts: facts(),
      nearbyInArea: [shared],
      nearbyAtCollege: [shared],
    });
    expect(spec.links.siblings).toHaveLength(1);
  });

  it("points into the SPA for the interactive part", () => {
    const spec = hostelPageSpec({ facts: facts() });
    expect(spec.links.app[0].href).toBe(
      "https://yourstayo.com/discover/h/sri-adithya-boys-hostel-yamnampet-36094ab4",
    );
  });

  it("uses the cover photo as the share image, or null rather than a placeholder", () => {
    expect(hostelPageSpec({ facts: facts() }).image).toBe("https://ik.imagekit.io/x/cover.jpg");
    expect(hostelPageSpec({ facts: facts({ photos: [] }) }).image).toBeNull();
  });
});

describe("collection pages", () => {
  const subject: CollectionSubject = {
    kind: "area",
    slug: "yamnampet",
    name: "Yamnampet",
    intro: null,
    parentName: "Hyderabad",
    parentSlug: "hyderabad",
  };

  const listings = [card(), card({ slug: "b-2222bbbb", name: "B", startingPrice: 9000 })];
  const stats = summariseListings(listings);

  it("is self-canonical at the unfiltered URL", () => {
    const spec = collectionPageSpec({ subject, stats, listings, intent: null });
    expect(spec.canonicalUrl).toBe("https://yourstayo.com/hostels-in/yamnampet");
  });

  it("gives an intent page its own canonical, not its parent's", () => {
    const intent = resolveIntent("boys")!;
    const spec = collectionPageSpec({ subject, stats, listings, intent });
    expect(spec.canonicalUrl).toBe("https://yourstayo.com/hostels-in/yamnampet/boys");
  });

  it("links an intent page back to the unfiltered collection", () => {
    const intent = resolveIntent("boys")!;
    const spec = collectionPageSpec({ subject, stats, listings, intent });
    expect(spec.links.parents[0].href).toBe("https://yourstayo.com/hostels-in/yamnampet");
  });

  it("routes a college subject to /hostels-near", () => {
    const college: CollectionSubject = {
      kind: "college", slug: "snist", name: "Sreenidhi", shortName: "SNIST", intro: null,
    };
    const spec = collectionPageSpec({ subject: college, stats, listings, intent: null });
    expect(spec.canonicalUrl).toBe("https://yourstayo.com/hostels-near/snist");
    expect(spec.kind).toBe("college");
  });

  it("carries a CollectionPage node and a breadcrumb trail", () => {
    const spec = collectionPageSpec({ subject, stats, listings, intent: null });
    expect(spec.jsonLd.map((node: any) => node["@type"])).toEqual([
      "CollectionPage",
      "BreadcrumbList",
    ]);
  });
});

describe("one generator, four kinds, distinct output", () => {
  it("gives every kind a different title and canonical", () => {
    const listings = [card()];
    const stats = summariseListings(listings);

    const specs = [
      hostelPageSpec({ facts: facts() }),
      collectionPageSpec({
        subject: { kind: "area", slug: "yamnampet", name: "Yamnampet", intro: null },
        stats, listings, intent: null,
      }),
      collectionPageSpec({
        subject: { kind: "city", slug: "hyderabad", name: "Hyderabad", intro: null },
        stats, listings, intent: null,
      }),
      collectionPageSpec({
        subject: { kind: "college", slug: "snist", name: "Sreenidhi", shortName: "SNIST", intro: null },
        stats, listings, intent: null,
      }),
    ];

    expect(new Set(specs.map((spec) => spec.title)).size).toBe(4);
    expect(new Set(specs.map((spec) => spec.canonicalUrl)).size).toBe(4);
    expect(new Set(specs.map((spec) => spec.kind)).size).toBe(4);
  });

  it("gives every page a non-empty H1 and description", () => {
    const listings = [card()];
    const stats = summariseListings(listings);
    const specs = [
      hostelPageSpec({ facts: facts() }),
      collectionPageSpec({
        subject: { kind: "area", slug: "y", name: "Y", intro: null }, stats, listings, intent: null,
      }),
    ];
    for (const spec of specs) {
      expect(spec.h1.trim().length).toBeGreaterThan(0);
      expect(spec.description.trim().length).toBeGreaterThan(0);
      expect(spec.lede.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("summariseListings", () => {
  it("derives its numbers from the very array the page renders", () => {
    const stats = summariseListings([
      card({ startingPrice: 7000, sharing: [4], foodIncluded: true, vacantBeds: 3 }),
      card({ slug: "b", startingPrice: 12000, sharing: [2], foodIncluded: false, vacantBeds: 0 }),
    ]);
    expect(stats).toMatchObject({
      listingCount: 2, minPrice: 7000, maxPrice: 12000, sharing: [2, 4], withFood: 1, withVacancy: 1,
    });
  });

  it("ignores an unpriced listing rather than treating it as ₹0", () => {
    const stats = summariseListings([card({ startingPrice: null }), card({ slug: "b", startingPrice: 9000 })]);
    expect(stats.minPrice).toBe(9000);
  });

  it("returns null prices when nothing in the set is priced", () => {
    const stats = summariseListings([card({ startingPrice: null })]);
    expect(stats.minPrice).toBeNull();
    expect(stats.maxPrice).toBeNull();
  });

  it("does not count vacancy it cannot trust", () => {
    const stats = summariseListings([card({ vacantBeds: 9, availabilityConfirmed: false })]);
    expect(stats.withVacancy).toBe(0);
  });

  it("handles an empty set", () => {
    expect(summariseListings([])).toMatchObject({ listingCount: 0, minPrice: null, sharing: [] });
  });
});
