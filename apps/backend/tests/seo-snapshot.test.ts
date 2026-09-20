import { describe, expect, it } from "vitest";

import { hostelPageSpec, collectionPageSpec, summariseListings } from "@/src/services/seo/page-spec";
import { serialiseJsonLd } from "@/src/services/seo/jsonld";
import { resolveIntent } from "@/src/services/seo/intents";
import type { CollectionSubject, HostelFacts, ListingCardFact } from "@/src/services/seo/types";

/**
 * Frozen SEO output for each page kind.
 *
 * WHAT THIS IS FOR: the fields below are the ones a reader never notices and
 * a crawler reads first — the title, the canonical, the structured data and
 * the heading order. A refactor that changes any of them changes how the page
 * ranks, and nothing else in the suite would object. Snapshotting them makes
 * that change something a human has to approve rather than something that
 * ships quietly.
 *
 * These snapshot the SPEC, not the rendered DOM: the components are thin
 * renderers over it, and the repo's frontend suite deliberately does not
 * render components. If a snapshot here changes, the question to ask is "did
 * I mean to change what this page tells Google". ADR-226.
 */

function facts(overrides: Partial<HostelFacts> = {}): HostelFacts {
  return {
    id: "36094ab4",
    slug: "sri-adithya-boys-hostel-yamnampet-36094ab4",
    name: "Sri Adithya Boys Hostel",
    areaName: "Yamnampet", areaSlug: "yamnampet",
    parentAreaName: "Ghatkesar", parentAreaSlug: "ghatkesar", cityAreaSlug: "hyderabad",
    areaAncestry: [
      { name: "Yamnampet", slug: "yamnampet", kind: "LOCALITY", published: true },
      { name: "Ghatkesar", slug: "ghatkesar", kind: "LOCALITY", published: true },
      { name: "Hyderabad", slug: "hyderabad", kind: "CITY", published: true },
    ],
    city: "Hyderabad", state: "Telangana", address: "Yamnampet",
    hostelType: "BOYS", foodIncluded: false, verified: true,
    startingPrice: 8200, sharing: [1, 2, 4],
    bedTiers: [
      { name: "4-Bed", sharing: 4, price: 8200, availability: "AVAILABLE", space: null },
      { name: "4-Bed", sharing: 4, price: 8500, availability: "AVAILABLE", space: null },
    ],
    tagline: "Walkable to SNIST",
    about: "A boys hostel a short walk from Sreenidhi.",
    highlights: [], amenities: ["High-speed Wi-Fi", "Power backup"],
    photos: ["https://ik.imagekit.io/x/cover.jpg"],
    vacantBeds: 107, availabilityConfirmed: true, platformListed: false,
    colleges: [
      { name: "Sreenidhi Institute of Science and Technology", shortName: "SNIST", slug: "snist", distanceText: "400 m", published: true },
    ],
    places: [], mess: null, host: null, navigation: null,
    reviewCount: 0, rating: null, reviews: [],
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

const listing: ListingCardFact = {
  slug: "sri-adithya-boys-hostel-yamnampet-36094ab4",
  name: "Sri Adithya Boys Hostel",
  areaName: "Yamnampet", city: "Hyderabad", hostelType: "BOYS",
  startingPrice: 8200, sharing: [1, 2, 4], foodIncluded: false,
  photo: "https://ik.imagekit.io/x/cover.jpg",
  vacantBeds: 107, availabilityConfirmed: true,
};

/** The crawler-visible surface, in a stable shape. */
function frozen(spec: ReturnType<typeof hostelPageSpec>) {
  return {
    kind: spec.kind,
    title: spec.title,
    description: spec.description,
    canonicalUrl: spec.canonicalUrl,
    robots: spec.robots,
    h1: spec.h1,
    headingOrder: ["h1", ...spec.jsonLd.map(() => "").filter(Boolean)],
    breadcrumbs: spec.breadcrumbs.map((c) => `${c.name} → ${c.url}`),
    jsonLdTypes: spec.jsonLd.map((node: any) => node["@type"]),
    jsonLd: JSON.parse(serialiseJsonLd(spec.jsonLd).join("\n").split("\n")[0].replace(/\\u003c/g, "<")),
    links: {
      parents: spec.links.parents.map((l) => l.href),
      siblings: spec.links.siblings.map((l) => l.href),
      intents: spec.links.intents.map((l) => l.href),
      app: spec.links.app.map((l) => l.href),
    },
  };
}

describe("hostel page", () => {
  it("freezes what it tells Google", () => {
    expect(frozen(hostelPageSpec({ facts: facts(), publishedCollegeSlugs: ["snist"] }))).toMatchSnapshot();
  });

  it("freezes the zero-review shape, where aggregateRating must be absent", () => {
    const spec = hostelPageSpec({ facts: facts() });
    const hostel = spec.jsonLd[0] as any;
    expect({
      hasAggregateRating: "aggregateRating" in hostel,
      hasReview: "review" in hostel,
      hasGeo: "geo" in hostel,
      hasTelephone: "telephone" in hostel,
      address: hostel.address,
      priceRange: hostel.priceRange,
      offerCount: hostel.makesOffer?.length ?? 0,
    }).toMatchSnapshot();
  });
});

describe("collection pages", () => {
  const stats = summariseListings([listing]);

  const subjects: [string, CollectionSubject][] = [
    ["locality", { kind: "area", slug: "yamnampet", name: "Yamnampet", intro: null, parentName: "Ghatkesar", parentSlug: "ghatkesar", state: "Telangana" }],
    ["city", { kind: "city", slug: "hyderabad", name: "Hyderabad", intro: null, state: "Telangana" }],
    ["college", { kind: "college", slug: "snist", name: "Sreenidhi Institute of Science and Technology", shortName: "SNIST", intro: null, parentName: "Yamnampet", parentSlug: "yamnampet" }],
  ];

  it.each(subjects)("freezes the %s page", (label, subject) => {
    const spec = collectionPageSpec({ subject, stats, listings: [listing], intent: null });
    expect(frozen(spec as any)).toMatchSnapshot(label);
  });

  it("freezes an intent variant, which must differ from its parent", () => {
    const [, subject] = subjects[0];
    const spec = collectionPageSpec({ subject, stats, listings: [listing], intent: resolveIntent("boys") });
    expect(frozen(spec as any)).toMatchSnapshot("locality+boys");
  });

  it("freezes the admin-written intro path, which is what makes two localities differ", () => {
    const [, subject] = subjects[0];
    const written = { ...subject, intro: "Yamnampet sits on the Warangal highway, five minutes from SNIST." };
    const spec = collectionPageSpec({ subject: written, stats, listings: [listing], intent: null });
    expect({ h1: spec.h1, lede: spec.lede, title: spec.title }).toMatchSnapshot("locality+intro");
  });
});
