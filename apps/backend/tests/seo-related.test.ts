import { describe, expect, it } from "vitest";
import {
  PRICE_BAND,
  relatedGroups,
  sameArea,
  sameCollege,
  similarPrice,
  similarSharing,
} from "@/src/services/seo/related";
import type { HostelFacts, ListingCardFact } from "@/src/services/seo/types";

function facts(overrides: Partial<HostelFacts> = {}): HostelFacts {
  return {
    id: "1", slug: "self-1111aaaa", name: "Self",
    areaName: "Yamnampet", areaSlug: "yamnampet",
    parentAreaName: "Ghatkesar", parentAreaSlug: "ghatkesar", cityAreaSlug: "hyderabad",
    areaAncestry: [], city: "Hyderabad", state: "Telangana", address: "Yamnampet",
    hostelType: "BOYS", foodIncluded: false, verified: true,
    startingPrice: 8000, sharing: [2, 4], bedTiers: [], tagline: null, about: null,
    highlights: [], amenities: [], photos: [], vacantBeds: 5,
    availabilityConfirmed: true, platformListed: false,
    colleges: [{ name: "Sreenidhi", shortName: "SNIST", slug: "snist", distanceText: "400 m", published: true }],
    places: [], mess: null, host: null, navigation: null,
    reviewCount: 0, rating: null, reviews: [], updatedAt: null,
    ...overrides,
  };
}

function card(slug: string, overrides: Partial<ListingCardFact> = {}): ListingCardFact {
  return {
    slug, name: slug.toUpperCase(), areaName: "Yamnampet", city: "Hyderabad",
    hostelType: "BOYS", startingPrice: 8000, sharing: [4], foodIncluded: false,
    photo: null, vacantBeds: 1, availabilityConfirmed: true, ...overrides,
  };
}

describe("a hostel never relates to itself", () => {
  it.each(["sameArea", "similarPrice", "similarSharing"] as const)("%s excludes it", (fn) => {
    const impls = { sameArea, similarPrice, similarSharing };
    const self = card("self-1111aaaa");
    expect(impls[fn](facts(), [self])).toHaveLength(0);
  });
});

describe("sameArea", () => {
  it("keeps only hostels in the same locality", () => {
    const picks = sameArea(facts(), [card("a"), card("b", { areaName: "Uppal" })]);
    expect(picks.map((p) => p.slug)).toEqual(["a"]);
  });

  it("yields nothing when the hostel has no curated area", () => {
    expect(sameArea(facts({ areaName: null }), [card("a")])).toHaveLength(0);
  });

  it("orders cheapest first — a reader scanning alternatives scans on price", () => {
    const picks = sameArea(facts(), [card("x", { startingPrice: 9000 }), card("y", { startingPrice: 7000 })]);
    expect(picks.map((p) => p.slug)).toEqual(["y", "x"]);
  });
});

describe("similarPrice", () => {
  it("keeps hostels inside the band and drops those outside", () => {
    const picks = similarPrice(facts({ startingPrice: 8000 }), [
      card("in-low", { startingPrice: 8000 * (1 - PRICE_BAND) }),
      card("in-high", { startingPrice: 8000 * (1 + PRICE_BAND) }),
      card("too-cheap", { startingPrice: 4000 }),
      card("too-dear", { startingPrice: 20000 }),
    ]);
    expect(picks.map((p) => p.slug).sort()).toEqual(["in-high", "in-low"]);
  });

  it("orders by closeness to the anchor", () => {
    const picks = similarPrice(facts({ startingPrice: 8000 }), [
      card("far", { startingPrice: 9800 }),
      card("near", { startingPrice: 8100 }),
    ]);
    expect(picks.map((p) => p.slug)).toEqual(["near", "far"]);
  });

  it("yields nothing rather than everything when this hostel is unpriced", () => {
    expect(similarPrice(facts({ startingPrice: null }), [card("a")])).toHaveLength(0);
  });

  it("ignores an unpriced candidate rather than treating it as ₹0", () => {
    expect(similarPrice(facts(), [card("a", { startingPrice: null })])).toHaveLength(0);
  });
});

describe("similarSharing", () => {
  it("matches on any shared capacity", () => {
    const picks = similarSharing(facts({ sharing: [2, 4] }), [
      card("four", { sharing: [4] }),
      card("single", { sharing: [1] }),
    ]);
    expect(picks.map((p) => p.slug)).toEqual(["four"]);
  });

  it("yields nothing when this hostel advertises no capacities", () => {
    expect(similarSharing(facts({ sharing: [] }), [card("a")])).toHaveLength(0);
  });
});

describe("sameCollege", () => {
  it("puts hostels with a recorded distance first", () => {
    const picks = sameCollege(facts(), [
      card("nodist", { distanceText: null, startingPrice: 6000 }),
      card("withdist", { distanceText: "400 m", startingPrice: 9000 }),
    ]);
    expect(picks[0].slug).toBe("withdist");
  });
});

describe("relatedGroups", () => {
  it("never lists one hostel under two headings", () => {
    const shared = card("shared", { sharing: [4], startingPrice: 8000 });
    const groups = relatedGroups({
      facts: facts(),
      inArea: [shared],
      nearCollege: [shared],
      all: [shared],
    });

    const slugs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("lets the strongest relation claim a hostel first", () => {
    const shared = card("shared");
    const groups = relatedGroups({ facts: facts(), inArea: [shared], all: [shared] });
    expect(groups[0].kind).toBe("same-area");
    expect(groups).toHaveLength(1);
  });

  it("names the locality and the campus in its headings", () => {
    const groups = relatedGroups({
      facts: facts(),
      inArea: [card("a")],
      nearCollege: [card("b", { areaName: "Uppal" })],
    });
    expect(groups.map((g) => g.heading)).toEqual([
      "Other hostels in Yamnampet",
      "Other hostels near SNIST",
    ]);
  });

  it("emits no empty groups", () => {
    for (const group of relatedGroups({ facts: facts(), inArea: [], all: [] })) {
      expect(group.links.length).toBeGreaterThan(0);
    }
  });

  it("returns nothing at all for the only hostel in the graph", () => {
    // Today's production reality — and an empty section must not render.
    expect(relatedGroups({ facts: facts(), inArea: [], nearCollege: [], all: [] })).toEqual([]);
  });

  it("builds every link through the canonical URL builder", () => {
    const groups = relatedGroups({ facts: facts(), inArea: [card("a")] });
    expect(groups[0].links[0].href).toBe("https://yourstayo.com/hostels/a");
  });
});
