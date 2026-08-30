import { describe, expect, it } from "vitest";
import { advertisedStartingPrice } from "@/src/services/discovery/listing-projection";

/** The real approved revision for Sunrise Residency, which is what exposed this. */
const SUNRISE_RESIDENCY = {
  beds: [
    { name: "2-bed", price: 12000, sharing: 2, availability: "AVAILABLE" },
    { name: "4 Sharing", price: 7000, sharing: 4, availability: "AVAILABLE" },
    { name: "Ground floor 4-bed", price: 8500, sharing: 4, availability: "AVAILABLE" },
  ],
};

describe("advertisedStartingPrice", () => {
  it("quotes the cheapest thing actually on sale", () => {
    // The card said ₹8,000 — min(rooms.base_rent), the operational rent, which
    // appears on no public page. The listing offers 4-sharing at ₹7,000.
    expect(advertisedStartingPrice(SUNRISE_RESIDENCY)).toBe(7000);
  });

  it("ignores bed types that are full", () => {
    // A "from" price nobody can take is not a price.
    const beds = {
      beds: [
        { name: "4 Sharing", price: 7000, availability: "FULL" },
        { name: "2-bed", price: 12000, availability: "AVAILABLE" },
      ],
    };
    expect(advertisedStartingPrice(beds)).toBe(12000);
  });

  it("falls back to the full set when nothing is available", () => {
    // A listing with no price is worse than one showing a full room's price;
    // the card states availability separately.
    const beds = {
      beds: [
        { name: "4 Sharing", price: 7000, availability: "FULL" },
        { name: "2-bed", price: 12000, availability: "FULL" },
      ],
    };
    expect(advertisedStartingPrice(beds)).toBe(7000);
  });

  it("treats an unpriced bed as unpriced, not free", () => {
    const beds = {
      beds: [
        { name: "Unpriced", price: 0, availability: "AVAILABLE" },
        { name: "Priced", price: 9000, availability: "AVAILABLE" },
      ],
    };
    expect(advertisedStartingPrice(beds)).toBe(9000);
  });

  it("returns null when the revision prices nothing, so the caller can fall back", () => {
    expect(advertisedStartingPrice({ beds: [] })).toBeNull();
    expect(advertisedStartingPrice({ beds: [{ name: "x", price: null }] })).toBeNull();
    expect(advertisedStartingPrice(null)).toBeNull();
    expect(advertisedStartingPrice({})).toBeNull();
  });

  it("survives a malformed revision rather than throwing on a public page", () => {
    expect(advertisedStartingPrice({ beds: "not an array" })).toBeNull();
    expect(advertisedStartingPrice({ beds: [null, undefined] })).toBeNull();
    expect(advertisedStartingPrice({ beds: [{ price: "abc" }] })).toBeNull();
  });

  it("is case-insensitive about availability", () => {
    expect(advertisedStartingPrice({ beds: [{ price: 5000, availability: "available" }] })).toBe(5000);
  });
});
