import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFERENCE_NAME,
  NavigationSchema,
  hasDirections,
  navigationGaps,
  parseNavigation,
  readNavigationSafely,
} from "@/src/services/discovery/hostel-navigation";

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

const full = {
  placeId: PLACE_ID,
  landmark: "Opposite SNIST Gate 2",
  entrancePhoto: "https://ik.imagekit.io/stayo/entrance.jpg",
  distanceFromReference: "400m",
  referenceName: "SNIST",
};

describe("NavigationSchema", () => {
  it("accepts a Place ID with only the required field, defaulting the rest", () => {
    const parsed = NavigationSchema.parse({ placeId: PLACE_ID });
    expect(parsed).toEqual({
      placeId: PLACE_ID,
      landmark: null,
      entrancePhoto: null,
      distanceFromReference: null,
      referenceName: DEFAULT_REFERENCE_NAME,
    });
  });

  it("rejects navigation with no Place ID — it is the whole point", () => {
    expect(NavigationSchema.safeParse({ landmark: "Opposite the gate" }).success).toBe(false);
    expect(NavigationSchema.safeParse({ placeId: "" }).success).toBe(false);
  });

  it("rejects a Place ID with characters Google never issues", () => {
    expect(NavigationSchema.safeParse({ placeId: "not a place id" }).success).toBe(false);
    expect(NavigationSchema.safeParse({ placeId: "ChIJ<script>alert(1)</script>" }).success).toBe(false);
    expect(NavigationSchema.safeParse({ placeId: "https://maps.google.com/?q=x" }).success).toBe(false);
  });

  it("accepts a short-but-valid id rather than insisting on a ChIJ prefix", () => {
    expect(NavigationSchema.safeParse({ placeId: "GhIJQWDl0CIeQUARxks3icF8U8A" }).success).toBe(true);
    expect(NavigationSchema.safeParse({ placeId: "EitTTklTVCBHYXRlIDIsIEh5ZA" }).success).toBe(true);
  });

  it("trims what an admin pastes, because a copied id carries whitespace", () => {
    expect(NavigationSchema.parse({ placeId: `  ${PLACE_ID}  ` }).placeId).toBe(PLACE_ID);
    expect(NavigationSchema.parse({ placeId: PLACE_ID, landmark: "  Gate 2  " }).landmark).toBe("Gate 2");
  });

  it("refuses an entrance photo that is not a URL", () => {
    expect(NavigationSchema.safeParse({ placeId: PLACE_ID, entrancePhoto: "entrance.jpg" }).success).toBe(false);
  });

  it("keeps a reference other than SNIST when one is given", () => {
    const parsed = NavigationSchema.parse({ placeId: PLACE_ID, referenceName: "VNRVJIET" });
    expect(parsed.referenceName).toBe("VNRVJIET");
  });
});

describe("parseNavigation", () => {
  it("returns the parsed object for a good row", () => {
    expect(parseNavigation(full)).toEqual(full);
  });

  it("returns null rather than throwing for a hostel nobody has located", () => {
    expect(parseNavigation(null)).toBeNull();
    expect(parseNavigation(undefined)).toBeNull();
  });

  it("degrades a malformed row to null instead of taking down a public listing", () => {
    expect(parseNavigation({ placeId: "" })).toBeNull();
    expect(parseNavigation({ landmark: "Gate 2" })).toBeNull();
    expect(parseNavigation("ChIJ-just-a-string")).toBeNull();
    expect(parseNavigation(42)).toBeNull();
    expect(parseNavigation([])).toBeNull();
  });
});

describe("hasDirections", () => {
  it("is true only when a Place ID survives parsing", () => {
    expect(hasDirections(full)).toBe(true);
    expect(hasDirections({ placeId: PLACE_ID })).toBe(true);
    expect(hasDirections(null)).toBe(false);
    expect(hasDirections({ landmark: "Opposite SNIST Gate 2" })).toBe(false);
  });
});

describe("navigationGaps", () => {
  it("names the Place ID first when there is nothing at all", () => {
    expect(navigationGaps(null)).toEqual(["Google Place ID"]);
    expect(navigationGaps({ landmark: "Gate 2" })).toEqual(["Google Place ID"]);
  });

  it("is empty for a fully described entrance", () => {
    expect(navigationGaps(full)).toEqual([]);
  });

  it("lists only what is actually missing, naming the real reference", () => {
    expect(navigationGaps({ placeId: PLACE_ID })).toEqual([
      "Landmark",
      "Entrance photo",
      "Distance from SNIST",
    ]);
    expect(navigationGaps({ ...full, entrancePhoto: null })).toEqual(["Entrance photo"]);
    expect(navigationGaps({ ...full, distanceFromReference: null, referenceName: "VNRVJIET" })).toEqual([
      "Distance from VNRVJIET",
    ]);
  });
});

describe("readNavigationSafely", () => {
  it("returns the navigation when the read succeeds", async () => {
    await expect(readNavigationSafely(async () => full)).resolves.toEqual(full);
  });

  it("survives the column not existing yet, which is how this shipped", async () => {
    // The real 2026-08-22 production error, verbatim. Code that selects
    // `navigation` reached production before migration 074 did, and every
    // listing detail page 500'd. A listing without directions beats no listing.
    const missingColumn = async () => {
      throw new Error("The column `t1.navigation` does not exist in the current database.");
    };
    await expect(readNavigationSafely(missingColumn)).resolves.toBeNull();
  });

  it("swallows any read failure rather than propagating it to the page", async () => {
    await expect(
      readNavigationSafely(async () => {
        throw new Error("connection reset");
      }),
    ).resolves.toBeNull();
  });

  it("still rejects a malformed row that reads back fine", async () => {
    await expect(readNavigationSafely(async () => ({ landmark: "Gate 2" }))).resolves.toBeNull();
    await expect(readNavigationSafely(async () => null)).resolves.toBeNull();
  });
});
