/**
 * Structured data: what it must say, and — mostly — what it must never say.
 *
 * Every assertion about an ABSENT property here corresponds to a real way a
 * marketplace gets a manual action: a rating nobody left, a bed that is not
 * free, a price that is not the price. These are the properties a future edit
 * is most likely to fill in helpfully, so each one is pinned. ADR-226.
 */

import { describe, it, expect } from "vitest";
import {
  breadcrumbList,
  collectionNode,
  hostelNode,
  itemListNode,
  serialiseJsonLd,
} from "@/src/services/seo/jsonld";
import type { HostelFacts, ListingCardFact } from "@/src/services/seo/types";

function facts(overrides: Partial<HostelFacts> = {}): HostelFacts {
  return {
    id: "36094ab4-1302-47e2-96bf-f0cbf937389e",
    slug: "sri-adithya-boys-hostel-yamnampet-36094ab4",
    name: "Sri Adithya Boys Hostel",
    areaName: "Yamnampet",
    areaSlug: "yamnampet",
    parentAreaName: "Ghatkesar",
    parentAreaSlug: "ghatkesar",
    cityAreaSlug: "hyderabad",
    areaAncestry: [
      { name: "Yamnampet", slug: "yamnampet", kind: "LOCALITY" },
      { name: "Ghatkesar", slug: "ghatkesar", kind: "LOCALITY" },
      { name: "Hyderabad", slug: "hyderabad", kind: "CITY" },
    ],
    city: "Hyderabad",
    state: "Telangana",
    address: "Yamnampet, Ghatkesar",
    hostelType: "BOYS",
    foodIncluded: false,
    verified: true,
    startingPrice: 8200,
    sharing: [1, 2, 4],
    bedTiers: [
      { name: "Single", sharing: 1, price: 14000, availability: "AVAILABLE", space: null },
      { name: "4-sharing", sharing: 4, price: 8200, availability: "BEDS_LEFT", space: null },
    ],
    tagline: "Walkable to SNIST",
    about: "A boys hostel a short walk from Sreenidhi.",
    highlights: [],
    amenities: ["Wi-Fi", "Power backup"],
    photos: ["https://ik.imagekit.io/kk1zji4ii/a.jpg"],
    vacantBeds: 107,
    availabilityConfirmed: true,
    platformListed: false,
    colleges: [
      { name: "Sreenidhi Institute of Science and Technology", shortName: "SNIST", slug: "snist", distanceText: "400 m" },
    ],
    places: [],
    mess: null,
    host: null,
    navigation: null,
    reviewCount: 0,
    rating: null,
    reviews: [],
    updatedAt: "2026-09-15T15:47:09.621Z",
    ...overrides,
  };
}

const PAGE = "https://yourstayo.com/hostels/sri-adithya-boys-hostel-yamnampet-36094ab4";

describe("hostelNode — aggregateRating", () => {
  it("is ABSENT when no review has been published", () => {
    const node = hostelNode(facts({ reviewCount: 0, rating: null }), PAGE);
    expect(node).not.toHaveProperty("aggregateRating");
  });

  it("is ABSENT when a count exists but no rating was computed", () => {
    const node = hostelNode(facts({ reviewCount: 4, rating: null }), PAGE);
    expect(node).not.toHaveProperty("aggregateRating");
  });

  it("is ABSENT when a rating exists but nothing was published", () => {
    const node = hostelNode(facts({ reviewCount: 0, rating: 4.8 }), PAGE);
    expect(node).not.toHaveProperty("aggregateRating");
  });

  it("appears only once a real published review backs it", () => {
    const node = hostelNode(
      facts({
        reviewCount: 6,
        rating: 4.5,
        reviews: [
          { rating: 5, body: "Clean and close to campus.", author: "Arun K.", stayDuration: "8 months", stayedHere: true, createdAt: "2026-09-01T00:00:00.000Z" },
        ],
      }),
      PAGE,
    ) as any;

    expect(node.aggregateRating).toMatchObject({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 6,
    });
  });

  it("ships the individual reviews with the aggregate, so the rating is visible", () => {
    // Google requires a rating in markup to appear on the page. The reviews
    // travel on the same fact object precisely so the two cannot diverge.
    const node = hostelNode(
      facts({
        reviewCount: 1,
        rating: 5,
        reviews: [
          { rating: 5, body: "Great place.", author: "Arun K.", stayDuration: null, stayedHere: true, createdAt: "2026-09-01T00:00:00.000Z" },
        ],
      }),
      PAGE,
    ) as any;

    expect(node.review).toHaveLength(1);
    expect(node.review[0]).toMatchObject({
      "@type": "Review",
      reviewRating: { ratingValue: 5, bestRating: 5 },
      author: { "@type": "Person", name: "Arun K." },
      datePublished: "2026-09-01",
    });
  });

  it("emits no Review nodes when there is no aggregate to back", () => {
    expect(hostelNode(facts({ reviewCount: 0, rating: null }), PAGE)).not.toHaveProperty("review");
  });

  it("caps the reviews it emits rather than shipping every one", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      rating: 4, body: `Review ${i}`, author: "A resident", stayDuration: null, stayedHere: true, createdAt: null,
    }));
    const node = hostelNode(facts({ reviewCount: 25, rating: 4, reviews: many }), PAGE) as any;
    expect(node.review).toHaveLength(10);
  });
});

describe("hostelNode — offers", () => {
  it("omits an unpriced tier entirely rather than quoting zero", () => {
    const node = hostelNode(
      facts({
        bedTiers: [
          { name: "Single", sharing: 1, price: null, availability: "AVAILABLE", space: null },
          { name: "4-sharing", sharing: 4, price: 8200, availability: "AVAILABLE", space: null },
        ],
      }),
      PAGE,
    ) as any;

    expect(node.makesOffer).toHaveLength(1);
    expect(node.makesOffer[0].price).toBe(8200);
    expect(JSON.stringify(node)).not.toContain('"price":0');
  });

  it("does not claim availability for a PLATFORM_LISTED hostel", () => {
    const node = hostelNode(
      facts({ platformListed: true, availabilityConfirmed: false }),
      PAGE,
    ) as any;

    for (const offer of node.makesOffer) {
      expect(offer).not.toHaveProperty("availability");
    }
  });

  it("marks a full tier SoldOut rather than InStock", () => {
    const node = hostelNode(
      facts({
        bedTiers: [{ name: "4-sharing", sharing: 4, price: 8200, availability: "FULL", space: null }],
      }),
      PAGE,
    ) as any;

    expect(node.makesOffer[0].availability).toBe("https://schema.org/SoldOut");
  });

  it("prices rent per month, not as a one-off", () => {
    const node = hostelNode(facts(), PAGE) as any;
    expect(node.makesOffer[0].priceSpecification.referenceQuantity.unitCode).toBe("MON");
  });
});

describe("hostelNode — omissions", () => {
  it("formats priceRange the way the page prints it, with Indian grouping", () => {
    const node = hostelNode(
      facts({
        bedTiers: [
          { name: "4-sharing", sharing: 4, price: 8200, availability: "AVAILABLE", space: null },
          { name: "Single", sharing: 1, price: 140000, availability: "AVAILABLE", space: null },
        ],
      }),
      PAGE,
    ) as any;

    // Not "₹8200–₹140000": structured data that formats a number differently
    // from the visible page is a mismatch that gets the markup discounted.
    expect(node.priceRange).toBe("₹8,200–₹1,40,000");
  });

  it("states a single price once rather than as a range of one", () => {
    const node = hostelNode(
      facts({
        bedTiers: [{ name: "4-sharing", sharing: 4, price: 8200, availability: "AVAILABLE", space: null }],
      }),
      PAGE,
    ) as any;
    expect(node.priceRange).toBe("₹8,200");
  });

  it("omits priceRange when nothing is priced", () => {
    const node = hostelNode(
      facts({
        startingPrice: null,
        bedTiers: [{ name: "4-sharing", sharing: 4, price: null, availability: null, space: null }],
      }),
      PAGE,
    );
    expect(node).not.toHaveProperty("priceRange");
  });

  it("never emits geo — there is no latitude or longitude in the schema", () => {
    expect(hostelNode(facts(), PAGE)).not.toHaveProperty("geo");
  });

  it("never emits a telephone", () => {
    expect(hostelNode(facts(), PAGE)).not.toHaveProperty("telephone");
  });

  it("splits the locality out of streetAddress instead of concatenating", () => {
    // The row held "Yamnampet,Ghatkesar" and the whole string went into
    // streetAddress — two places Google knows, concatenated into one string
    // it knows nothing about.
    const node = hostelNode(facts({ address: "Yamnampet" }), PAGE) as any;
    expect(node.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Yamnampet",
      addressLocality: "Ghatkesar",
      addressRegion: "Telangana",
      addressCountry: "India",
    });
  });

  it("keeps a real street line and does not overwrite it with the locality", () => {
    const node = hostelNode(facts({ address: "Plot 12, Road No 5" }), PAGE) as any;
    expect(node.address.streetAddress).toBe("Plot 12, Road No 5");
    expect(node.address.addressLocality).toBe("Ghatkesar");
  });

  it("falls back to the locality when the owner wrote no address", () => {
    const node = hostelNode(facts({ address: null }), PAGE) as any;
    expect(node.address.streetAddress).toBe("Yamnampet");
  });

  it("never repeats one place in two fields", () => {
    const node = hostelNode(
      facts({ address: "Ghatkesar", areaName: "Ghatkesar", parentAreaName: "Ghatkesar" }),
      PAGE,
    ) as any;
    expect(node.address.streetAddress).toBe("Ghatkesar");
    expect(node.address).not.toHaveProperty("addressLocality");
  });

  it("uses the city as the locality when the hostel has no curated parent", () => {
    const node = hostelNode(
      facts({ address: "Some Street", areaName: null, parentAreaName: null, city: "Hyderabad" }),
      PAGE,
    ) as any;
    expect(node.address.addressLocality).toBe("Hyderabad");
  });

  it("omits the address node when nothing locates the hostel", () => {
    // `addressCountry` alone is not an address — emitting one that says only
    // "India" is worse than emitting none.
    const node = hostelNode(
      facts({ address: null, areaName: null, parentAreaName: null, city: null, state: null }),
      PAGE,
    );
    expect(node).not.toHaveProperty("address");
  });

  it("keeps the address when only a locality is known", () => {
    const node = hostelNode(
      facts({ address: null, state: null, parentAreaName: null, city: null }),
      PAGE,
    ) as any;
    expect(node.address.streetAddress).toBe("Yamnampet");
    expect(node.address).not.toHaveProperty("addressLocality");
    expect(node.address).not.toHaveProperty("addressRegion");
  });

  it("omits amenityFeature rather than emitting an empty list", () => {
    expect(hostelNode(facts({ amenities: [] }), PAGE)).not.toHaveProperty("amenityFeature");
  });

  it("omits description when the owner has written neither about nor tagline", () => {
    expect(hostelNode(facts({ about: null, tagline: null }), PAGE)).not.toHaveProperty("description");
  });
});

describe("serialisation", () => {
  it("escapes a closing script tag so markup cannot break out", () => {
    const [json] = serialiseJsonLd([hostelNode(facts({ name: "</script><script>alert(1)" }), PAGE)]);
    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c");
    expect(() => JSON.parse(json.replace(/\\u003c/g, "<"))).not.toThrow();
  });

  it("produces valid JSON for every node type", () => {
    const nodes = [
      hostelNode(facts(), PAGE),
      breadcrumbList([{ name: "Stayo", url: "https://yourstayo.com" }]),
      itemListNode([]),
    ];
    for (const json of serialiseJsonLd(nodes)) {
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });
});

describe("breadcrumbList", () => {
  it("numbers positions from one, in order", () => {
    const node = breadcrumbList([
      { name: "Stayo", url: "https://yourstayo.com" },
      { name: "Hyderabad", url: "https://yourstayo.com/hostels-in/hyderabad" },
      { name: "Sri Adithya", url: PAGE },
    ]) as any;

    expect(node.itemListElement.map((item: any) => item.position)).toEqual([1, 2, 3]);
    expect(node.itemListElement[2].item).toBe(PAGE);
  });
});

describe("collectionNode", () => {
  const listings: ListingCardFact[] = [
    {
      slug: "a-hostel-yamnampet-1111aaaa",
      name: "A Hostel",
      areaName: "Yamnampet",
      city: "Hyderabad",
      hostelType: "BOYS",
      startingPrice: 7000,
      sharing: [4],
      foodIncluded: true,
      photo: "https://ik.imagekit.io/x/a.jpg",
      vacantBeds: 3,
      availabilityConfirmed: true,
    },
  ];

  it("describes a college page as being about the college", () => {
    const node = collectionNode({
      subject: {
        kind: "college",
        slug: "snist",
        name: "Sreenidhi Institute of Science and Technology",
        shortName: "SNIST",
        intro: null,
      },
      stats: { listingCount: 1, minPrice: 7000, maxPrice: 7000, sharing: [4], withFood: 1, withVacancy: 1, types: ["BOYS"] },
      listings,
      pageUrl: "https://yourstayo.com/hostels-near/snist",
      name: "Hostels near SNIST",
      description: "…",
    }) as any;

    expect(node.about["@type"]).toBe("CollegeOrUniversity");
    expect(node.about.alternateName).toBe("SNIST");
    expect(node.mainEntity.numberOfItems).toBe(1);
  });

  it("never lifts a free-text distance into the structured data", () => {
    const node = collectionNode({
      subject: { kind: "college", slug: "snist", name: "SNIST", shortName: "SNIST", intro: null },
      stats: { listingCount: 1, minPrice: 7000, maxPrice: 7000, sharing: [4], withFood: 0, withVacancy: 0, types: [] },
      listings: [{ ...listings[0], distanceText: "5 min walk" }],
      pageUrl: "https://yourstayo.com/hostels-near/snist",
      name: "Hostels near SNIST",
      description: "…",
    });

    expect(JSON.stringify(node)).not.toContain("5 min walk");
  });

  it("points every list item at the canonical hostel URL", () => {
    const node = itemListNode(listings) as any;
    expect(node.itemListElement[0].url).toBe(
      "https://yourstayo.com/hostels/a-hostel-yamnampet-1111aaaa",
    );
  });
});
