import { describe, it, expect } from "vitest";
import { projectListing } from "@/src/services/discovery/listing-projection";

const detail = {
  hostel: { id: "h1", name: "Starlink", city: "Hyderabad", photos: ["/admissions-1.jpg"] },
  rooms: [{ capacity: 2, base_rent: 8000 }],
};

const visible = { id: "h1", hostel_type: "BOYS", food_included: true, listing_source: "OWNER_MANAGED" };

const marketing = {
  basics: { tagline: "Sea-facing rooms", about: "A calm place", highlights: ["Wi-Fi"] },
  photos: [{ url: "/owner-1.jpg" }, { url: "/owner-2.jpg" }],
  beds: [{ sharing: "DOUBLE", price: 8500, deposit: 9000, availability: "AVAILABLE" }],
  amenities: [
    { key: "wifi", label: "Wi-Fi", enabled: true },
    { key: "gym", label: "Gym", enabled: false },
  ],
  places: [{ name: "Metro", distance_km: 0.4 }],
  mess: {
    provided: true,
    meals: [
      { key: "BREAKFAST", enabled: true, dishes: ["Idli"] },
      { key: "SUPPER", enabled: false, dishes: [] },
    ],
    week: [],
  },
} as any;

describe("projectListing", () => {
  it("prefers owner-published photos over the admissions gallery", () => {
    expect(projectListing({ detail, visible, marketing }).hostel.photos)
      .toEqual(["/owner-1.jpg", "/owner-2.jpg"]);
  });

  it("falls back to admissions photos when marketing has none", () => {
    const out = projectListing({ detail, visible, marketing: { ...marketing, photos: [] } });
    expect(out.hostel.photos).toEqual(["/admissions-1.jpg"]);
  });

  it("drops amenities the owner switched off", () => {
    expect(projectListing({ detail, visible, marketing }).amenities.map((a: any) => a.key))
      .toEqual(["wifi"]);
  });

  it("drops meals the owner switched off, so a listing never advertises one", () => {
    const mess = projectListing({ detail, visible, marketing }).mess;
    expect(mess.meals.map((m: any) => m.key)).toEqual(["BREAKFAST"]);
  });

  it("returns mess as null when the hostel does not serve meals", () => {
    const out = projectListing({
      detail, visible, marketing: { ...marketing, mess: { ...marketing.mess, provided: false } },
    });
    expect(out.mess).toBeNull();
  });

  it("carries no marketing at all without throwing", () => {
    const out = projectListing({ detail, visible, marketing: null });
    expect(out.marketing_published).toBe(false);
    expect(out.bed_tiers).toEqual([]);
    expect(out.hostel.tagline).toBeNull();
  });
});

/**
 * The load-bearing property of a platform listing: nobody operates it inside
 * Stayo, so it has no real rooms. Its bed tiers are an advertised claim.
 * Rendering a live vacancy count would advertise beds nobody can honour.
 */
describe("platform-listed hostels never advertise live vacancy", () => {
  const platform = { ...visible, listing_source: "PLATFORM_LISTED" };

  it("marks availability as unconfirmed", () => {
    const out = projectListing({ detail, visible: platform, marketing });
    expect(out.availability_confirmed).toBe(false);
  });

  it("confirms availability for an owner-managed hostel", () => {
    const out = projectListing({ detail, visible, marketing });
    expect(out.availability_confirmed).toBe(true);
  });

  it("still shows the advertised bed tiers — they are the offer, not inventory", () => {
    const out = projectListing({ detail, visible: platform, marketing });
    expect(out.bed_tiers).toHaveLength(1);
  });

  it("flags itself as platform listed so the UI can say so", () => {
    expect(projectListing({ detail, visible: platform, marketing }).platform_listed).toBe(true);
    expect(projectListing({ detail, visible, marketing }).platform_listed).toBe(false);
  });
});

/**
 * Preview must be the same code path as the live listing. If these two ever
 * diverge, the admin approves something other than what ships.
 */
describe("preview parity", () => {
  it("produces identical output for identical content", () => {
    const live = projectListing({ detail, visible, marketing });
    const preview = projectListing({ detail, visible, marketing, preview: true });
    const { preview: _a, ...liveRest } = live as any;
    const { preview: _b, ...previewRest } = preview as any;
    expect(previewRest).toEqual(liveRest);
  });

  it("marks a preview so the UI can badge it, without changing the content", () => {
    expect(projectListing({ detail, visible, marketing, preview: true }).preview).toBe(true);
    expect(projectListing({ detail, visible, marketing }).preview).toBe(false);
  });
});
