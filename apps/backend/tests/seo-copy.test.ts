/**
 * The words.
 *
 * Two properties are load-bearing: no page may claim something no column
 * backs, and no two pages may share a title. ADR-224.
 */

import { describe, it, expect } from "vitest";
import {
  audiencePhrase,
  availabilityBand,
  collectionDescription,
  collectionHeading,
  collectionLede,
  collectionTitle,
  hostelDescription,
  hostelHeading,
  hostelLede,
  hostelTitle,
  sharingLabel,
} from "@/src/services/seo/copy";
import { resolveIntent } from "@/src/services/seo/intents";
import type { CollectionStats, CollectionSubject, HostelFacts } from "@/src/services/seo/types";

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
    bedTiers: [],
    tagline: null,
    about: null,
    highlights: [],
    amenities: [],
    photos: [],
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

describe("prices are never invented", () => {
  it("says 'Price on request', never ₹0, when nothing is priced", () => {
    const description = hostelDescription(facts({ startingPrice: null }));
    expect(description).toContain("Price on request");
    expect(description).not.toContain("₹0");
  });

  it("keeps the title readable with no price at all", () => {
    const title = hostelTitle(facts({ startingPrice: null }));
    expect(title).not.toContain("₹");
    expect(title).not.toContain("from  ");
    expect(title).not.toMatch(/—\s*\|/);
  });

  it("groups rupees the Indian way", () => {
    expect(hostelTitle(facts({ startingPrice: 120000 }))).toContain("₹1,20,000");
  });
});

describe("titles are unique across hostels", () => {
  it("varies on locality, so one chain's two hostels do not collide", () => {
    const a = hostelTitle(facts({ areaName: "Yamnampet" }));
    const b = hostelTitle(facts({ areaName: "Ghatkesar" }));
    expect(a).not.toBe(b);
  });

  it("varies on audience", () => {
    expect(hostelTitle(facts({ hostelType: "BOYS" }))).not.toBe(
      hostelTitle(facts({ hostelType: "GIRLS" })),
    );
  });

  it("varies on price", () => {
    expect(hostelTitle(facts({ startingPrice: 7000 }))).not.toBe(
      hostelTitle(facts({ startingPrice: 9000 })),
    );
  });

  it("puts the hostel's own name first — the branded search it must win", () => {
    expect(hostelTitle(facts()).startsWith("Sri Adithya Boys Hostel")).toBe(true);
  });

  it("differs from the on-page H1, which carries no site suffix", () => {
    const f = facts();
    expect(hostelHeading(f)).toBe("Sri Adithya Boys Hostel, Yamnampet");
    expect(hostelTitle(f)).not.toBe(hostelHeading(f));
    expect(hostelHeading(f)).not.toContain("| Stayo");
  });
});

describe("the college phrase — the highest-intent thing Stayo can say", () => {
  it("uses the measured distance when one was recorded", () => {
    expect(hostelDescription(facts())).toContain("400 m from SNIST");
  });

  it("says only 'near' when no distance was recorded", () => {
    const description = hostelDescription(
      facts({ colleges: [{ name: "Sreenidhi", shortName: "SNIST", slug: "snist", distanceText: null }] }),
    );
    expect(description).toContain("near SNIST");
    expect(description).not.toMatch(/\d+\s*m from/);
  });

  it("says nothing about a college when none is linked", () => {
    const description = hostelDescription(facts({ colleges: [] }));
    expect(description).not.toContain("SNIST");
    expect(description).not.toContain("near");
  });
});

describe("the owner's words win", () => {
  it("uses an approved tagline verbatim rather than generating one", () => {
    expect(hostelLede(facts({ tagline: "Home away from home, 400m from campus." }))).toBe(
      "Home away from home, 400m from campus.",
    );
  });

  it("composes a lede only when the owner has not written one", () => {
    expect(hostelLede(facts({ tagline: null }))).toContain("Yamnampet");
  });
});

describe("availability is a band, not a count", () => {
  it("never states a number", () => {
    const band = availabilityBand({ vacantBeds: 107, availabilityConfirmed: true });
    expect(band).toEqual({ label: "Beds available", open: true });
    expect(JSON.stringify(band)).not.toContain("107");
  });

  it("says full rather than 'no beds available'", () => {
    expect(availabilityBand({ vacantBeds: 0, availabilityConfirmed: true })?.open).toBe(false);
  });

  it("renders nothing at all when vacancy cannot be trusted", () => {
    expect(availabilityBand({ vacantBeds: 5, availabilityConfirmed: false })).toBeNull();
    expect(availabilityBand({ vacantBeds: null, availabilityConfirmed: true })).toBeNull();
  });

  it("is absent from the meta description, which outlives its own accuracy", () => {
    const description = hostelDescription(facts());
    expect(description).not.toContain("107");
    expect(description.toLowerCase()).not.toContain("beds available");
  });
});

describe("vocabulary", () => {
  it("reads capacities the way a student says them", () => {
    expect(sharingLabel([1, 2, 4])).toBe("single, 2-bed, 4-bed");
    expect(sharingLabel([])).toBeNull();
  });

  it("sorts capacities however they arrive", () => {
    expect(sharingLabel([4, 1, 2])).toBe("single, 2-bed, 4-bed");
  });

  it("falls back to plain 'hostels' rather than guessing an audience", () => {
    expect(audiencePhrase(null)).toBe("hostels");
    expect(audiencePhrase("BOYS")).toBe("boys hostels");
  });
});

describe("collection copy", () => {
  const subject: CollectionSubject = {
    kind: "area",
    slug: "yamnampet",
    name: "Yamnampet",
    intro: null,
    parentName: "Hyderabad",
    parentSlug: "hyderabad",
  };

  const stats: CollectionStats = {
    listingCount: 7,
    minPrice: 6500,
    maxPrice: 12000,
    sharing: [2, 3, 4],
    withFood: 4,
    withVacancy: 5,
    types: ["BOYS", "GIRLS"],
  };

  it("names the place and the real count", () => {
    expect(collectionHeading(subject, null)).toBe("Hostels in Yamnampet");
    expect(collectionTitle(subject, stats, null)).toContain("7 verified");
    expect(collectionTitle(subject, stats, null)).toContain("₹6,500");
  });

  it("uses 'near' for a college and 'in' for a place", () => {
    const college: CollectionSubject = {
      kind: "college", slug: "snist", name: "Sreenidhi", shortName: "SNIST", intro: null,
    };
    expect(collectionHeading(college, null)).toBe("Hostels near SNIST");
  });

  it("folds an intent into the heading", () => {
    const intent = resolveIntent("boys")!;
    expect(collectionHeading(subject, intent)).toBe("Boys hostels in Yamnampet");
  });

  it("gives an intent page a different title from its parent", () => {
    const intent = resolveIntent("under-8000")!;
    expect(collectionTitle(subject, stats, intent)).not.toBe(collectionTitle(subject, stats, null));
  });

  it("prefers the admin's written intro — this is what stops two locality pages reading alike", () => {
    const written = { ...subject, intro: "Yamnampet sits on the Warangal highway, five minutes from SNIST." };
    expect(collectionLede(written, stats, null)).toBe(written.intro);
  });

  it("composes a lede from real counts when no intro is written", () => {
    const lede = collectionLede(subject, stats, null);
    expect(lede).toContain("7 verified");
    expect(lede).toContain("₹6,500");
    expect(lede).toContain("₹12,000");
  });

  it("states a single price once rather than as a range of one", () => {
    const flat = { ...stats, minPrice: 7000, maxPrice: 7000 };
    expect(collectionLede(subject, flat, null)).toContain("at ₹7,000 a month");
  });

  it("omits price language entirely when nothing in the set is priced", () => {
    const unpriced = { ...stats, minPrice: null, maxPrice: null };
    expect(collectionDescription(subject, unpriced, null)).not.toContain("₹");
    expect(collectionLede(subject, unpriced, null)).not.toContain("₹");
  });
});
