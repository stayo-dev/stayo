import { describe, expect, it, vi } from "vitest";

/**
 * The mapping from the live listing payload into the narrow fact shape a page
 * is allowed to render.
 *
 * `@/lib/db` is mocked, so no client is constructed and no database is
 * reachable — which is what qualifies this file for the pure config.
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    hostels: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
  supabase: {},
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: any) => fn,
  revalidateTag: vi.fn(),
}));

import { toHostelFacts } from "@/src/services/seo/seo-service";

/** Shaped like `projectListing`'s output, trimmed to what the mapper reads. */
function listing(overrides: Record<string, any> = {}) {
  return {
    hostel: {
      id: "36094ab4-1302-47e2-96bf-f0cbf937389e",
      public_slug: "sri-adithya-boys-hostel-36094ab4",
      name: "Sri Adithya Boys Hostel",
      city: "Hyderabad",
      state: "Telangana",
      address: "Yamnampet",
      hostel_type: "BOYS",
      food_included: false,
      tagline: null,
      about: null,
      highlights: [],
      photos: ["https://ik.imagekit.io/x/a.jpg"],
      starting_price: 8200,
    },
    // Real inventory: single, 2-bed and 4-bed rooms exist.
    rooms: [
      { capacity: 1, available_beds: 2 },
      { capacity: 2, available_beds: 4 },
      { capacity: 4, available_beds: 101 },
    ],
    // The approved revision prices only 4-bed tiers.
    bed_tiers: [
      { name: "4-Bed", sharing: 4, price: 8200, availability: "AVAILABLE" },
      { name: "4-Bed", sharing: 4, price: 8500, availability: "AVAILABLE" },
    ],
    amenities: [{ label: "High-speed Wi-Fi" }, { label: "Power backup" }],
    places: [],
    mess: null,
    host: null,
    navigation: null,
    availability_confirmed: true,
    platform_listed: false,
    ...overrides,
  };
}

describe("sharing comes from real rooms, not from priced tiers", () => {
  it("lists every capacity the hostel actually has", () => {
    // The regression this pins: search filters on `rooms.capacity`, so a
    // seeker filtering for a single room reaches this page. A tier-derived
    // list would have said "4-bed" only — the card promising one thing and
    // the page it links to saying another.
    expect(toHostelFacts(listing()).sharing).toEqual([1, 2, 4]);
  });

  it("agrees with what the share card says about the same hostel", () => {
    // `summariseRooms` (share card, search card) derives from rooms too.
    const facts = toHostelFacts(listing());
    const fromRooms = Array.from(new Set(listing().rooms.map((room) => room.capacity))).sort();
    expect(facts.sharing).toEqual(fromRooms);
  });

  it("falls back to the advertised tiers when there are no real rooms", () => {
    const facts = toHostelFacts(listing({ rooms: [], platform_listed: true, availability_confirmed: false }));
    expect(facts.sharing).toEqual([4]);
  });
});

describe("price comes from the advertised offer", () => {
  it("takes the cheapest available tier, not the operational rent", () => {
    expect(toHostelFacts(listing()).startingPrice).toBe(8200);
  });

  it("falls back to the operational figure when the revision prices nothing", () => {
    const facts = toHostelFacts(listing({ bed_tiers: [] }));
    expect(facts.startingPrice).toBe(8200);
  });

  it("treats an unpriced tier as unpriced, never as ₹0", () => {
    const facts = toHostelFacts(
      listing({
        bed_tiers: [{ name: "4-Bed", sharing: 4, price: 0, availability: "AVAILABLE" }],
        hostel: { ...listing().hostel, starting_price: null },
      }),
    );
    expect(facts.startingPrice).toBeNull();
    expect(facts.bedTiers[0].price).toBeNull();
  });
});

describe("colleges are read from admin-entered navigation", () => {
  it("adds a unit to a bare metre count without changing the number", () => {
    const facts = toHostelFacts(
      listing({ navigation: { referenceName: "SNIST", distanceFromReference: "400", landmark: null } }),
    );
    expect(facts.colleges[0]).toMatchObject({ name: "SNIST", slug: "snist", distanceText: "400 m" });
  });

  it("leaves a distance that already reads as prose alone", () => {
    const facts = toHostelFacts(
      listing({ navigation: { referenceName: "SNIST", distanceFromReference: "5 min walk", landmark: null } }),
    );
    expect(facts.colleges[0].distanceText).toBe("5 min walk");
  });

  it("records no distance rather than guessing one", () => {
    const facts = toHostelFacts(
      listing({ navigation: { referenceName: "SNIST", distanceFromReference: null, landmark: null } }),
    );
    expect(facts.colleges[0].distanceText).toBeNull();
  });

  it("also reads colleges the owner listed under places", () => {
    const facts = toHostelFacts(
      listing({ places: [{ name: "JNTUH", distance: "8 km", category: "COLLEGE" }] }),
    );
    expect(facts.colleges.map((c) => c.slug)).toContain("jntuh");
  });

  it("ignores a nearby place that is not a college", () => {
    const facts = toHostelFacts(
      listing({ places: [{ name: "Metro station", distance: "1 km", category: "TRANSPORT" }] }),
    );
    expect(facts.colleges).toHaveLength(0);
  });

  it("does not list the same college twice when navigation and places agree", () => {
    const facts = toHostelFacts(
      listing({
        navigation: { referenceName: "SNIST", distanceFromReference: "400", landmark: null },
        places: [{ name: "SNIST", distance: "400 m", category: "COLLEGE" }],
      }),
    );
    expect(facts.colleges).toHaveLength(1);
  });
});

describe("reviews are scoped to the hostel, never to the host", () => {
  /**
   * The bug this pins, found by rendering the real page: the mapper first read
   * `listing.host.stats`, which `loadHostStats` aggregates **across every
   * hostel the owner runs**. For a multi-hostel owner that put reviews written
   * about one hostel into another hostel's `aggregateRating` — a rating no
   * reader of that page could verify, on the one property Google requires be
   * visible on the page carrying it.
   */
  it("ignores host-level stats entirely", () => {
    const facts = toHostelFacts(
      listing({ host: { stats: { review_count: 42, rating: 4.9, residents: 120 } } }),
      // No hostel-scoped reviews passed: the host's 42 must not leak through.
    );
    expect(facts.reviewCount).toBe(0);
    expect(facts.rating).toBeNull();
    expect(facts.reviews).toEqual([]);
  });

  it("uses the hostel's own published reviews when they are passed", () => {
    const facts = toHostelFacts(listing({ host: { stats: { review_count: 42, rating: 4.9 } } }), {
      reviews: {
        count: 1,
        average: 5,
        items: [
          { rating: 5, body: "Close to SNIST.", author: "Arun K.", stayDuration: "8 months", stayedHere: true, createdAt: null },
        ],
      },
    });

    expect(facts.reviewCount).toBe(1);
    expect(facts.rating).toBe(5);
    expect(facts.reviews).toHaveLength(1);
  });

  it("respects a null average — it does not compute its own mean", () => {
    // `MIN_REVIEWS_FOR_AVERAGE` lives in review-summary.ts; the page defers to
    // whatever that service decided rather than averaging the items itself.
    const facts = toHostelFacts(listing(), {
      reviews: {
        count: 2,
        average: null,
        items: [
          { rating: 5, body: null, author: "A resident", stayDuration: null, stayedHere: true, createdAt: null },
          { rating: 3, body: null, author: "A resident", stayDuration: null, stayedHere: true, createdAt: null },
        ],
      },
    });

    expect(facts.rating).toBeNull();
    expect(facts.reviews).toHaveLength(2);
  });
});

describe("what the mapper refuses to carry", () => {
  it("reports zero reviews and no rating for a hostel with none", () => {
    const facts = toHostelFacts(listing());
    expect(facts.reviewCount).toBe(0);
    expect(facts.rating).toBeNull();
  });

  it("marks vacancy untrustworthy for a platform listing", () => {
    const facts = toHostelFacts(listing({ platform_listed: true, availability_confirmed: false }));
    expect(facts.availabilityConfirmed).toBe(false);
  });

  it("sums real vacancy across rooms", () => {
    expect(toHostelFacts(listing()).vacantBeds).toBe(107);
  });

  it("carries no locality in phase 1, rather than guessing one from the address", () => {
    const facts = toHostelFacts(listing());
    expect(facts.areaName).toBeNull();
    expect(facts.areaSlug).toBeNull();
    expect(facts.city).toBe("Hyderabad");
  });
});
