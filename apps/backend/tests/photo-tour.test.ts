import { describe, it, expect } from "vitest";
import { flattenTour, groupPhotoTour, sectionCover, type TourItem } from "@/src/services/discovery/photo-tour";
import { orderPhotoSections } from "@/src/services/marketing/marketing-content";

const item = (over: Partial<TourItem> = {}): TourItem => ({
  url: "https://x/1.jpg",
  kind: "image",
  thumbnail_url: null,
  label: null,
  category: "other",
  ...over,
});

describe("groupPhotoTour", () => {
  it("groups photos into the parts of a hostel", () => {
    const sections = groupPhotoTour([
      item({ url: "r1", category: "rooms" }),
      item({ url: "m1", category: "mess" }),
      item({ url: "r2", category: "rooms" }),
    ]);
    expect(sections.map((s) => s.key)).toEqual(["rooms", "mess"]);
    expect(sections[0].items.map((i) => i.url)).toEqual(["r1", "r2"]);
  });

  it("orders sections the way someone decides, not alphabetically", () => {
    // Where you sleep, then where you wash, then where you eat.
    const sections = groupPhotoTour([
      item({ category: "outside" }),
      item({ category: "bathrooms" }),
      item({ category: "rooms" }),
    ]);
    expect(sections.map((s) => s.key)).toEqual(["rooms", "bathrooms", "outside"]);
  });

  it("follows the order the owner arranged, over the standard one", () => {
    // An all-girls PG whose selling point is the mess may well want to lead
    // with it. The standard order is a default, not a rule.
    const sections = groupPhotoTour(
      [item({ category: "rooms" }), item({ category: "mess" }), item({ category: "bathrooms" })],
      ["mess", "bathrooms", "rooms"],
    );
    expect(sections.map((s) => s.key)).toEqual(["mess", "bathrooms", "rooms"]);
  });

  it("keeps the standard order for sections the owner never placed", () => {
    // A partial order is what an owner who moved one section leaves behind,
    // and what an older revision saved before a new category existed holds.
    const sections = groupPhotoTour(
      [item({ category: "rooms" }), item({ category: "outside" }), item({ category: "bathrooms" })],
      ["outside"],
    );
    expect(sections.map((s) => s.key)).toEqual(["outside", "rooms", "bathrooms"]);
  });

  it("ignores a section key it does not recognise", () => {
    const sections = groupPhotoTour(
      [item({ category: "rooms" }), item({ category: "mess" })],
      ["terrace", "mess"] as any,
    );
    expect(sections.map((s) => s.key)).toEqual(["mess", "rooms"]);
  });

  it("never shows an empty section", () => {
    expect(groupPhotoTour([item({ category: "rooms" })]).map((s) => s.key)).toEqual(["rooms"]);
    expect(groupPhotoTour([])).toEqual([]);
  });

  it("puts uncategorised photos in More photos rather than dropping them", () => {
    // Everything uploaded before categories existed has no category.
    const sections = groupPhotoTour([item({ category: undefined as any })]);
    expect(sections.map((s) => s.key)).toEqual(["other"]);
  });

  it("keeps a video with the photos of the same place", () => {
    const sections = groupPhotoTour([
      item({ url: "r1", category: "rooms" }),
      item({ url: "v1", category: "rooms", kind: "video" }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((i) => i.kind)).toEqual(["image", "video"]);
  });
});

describe("sectionCover", () => {
  it("represents a section with its first photo", () => {
    const section = groupPhotoTour([item({ url: "a", category: "rooms" }), item({ url: "b", category: "rooms" })])[0];
    expect(sectionCover(section)?.url).toBe("a");
  });

  it("prefers a still over a video, which cannot be a thumbnail", () => {
    const section = groupPhotoTour([
      item({ url: "v", category: "rooms", kind: "video" }),
      item({ url: "p", category: "rooms" }),
    ])[0];
    expect(sectionCover(section)?.url).toBe("p");
  });

  it("falls back to the video when a section is all video", () => {
    const section = groupPhotoTour([item({ url: "v", category: "rooms", kind: "video" })])[0];
    expect(sectionCover(section)?.url).toBe("v");
  });
});

describe("flattenTour", () => {
  it("gives the viewer one list in the order the tour shows", () => {
    // "Next" from the last room photo must land on the first bathroom photo,
    // not somewhere the grid never showed.
    const sections = groupPhotoTour([
      item({ url: "b1", category: "bathrooms" }),
      item({ url: "r1", category: "rooms" }),
      item({ url: "r2", category: "rooms" }),
    ]);
    expect(flattenTour(sections).map((i) => i.url)).toEqual(["r1", "r2", "b1"]);
  });
});

describe("orderPhotoSections", () => {
  const CANONICAL = ["rooms", "bathrooms", "mess", "common", "study", "outside", "other"];

  it("is the standard order when nobody has arranged anything", () => {
    expect(orderPhotoSections(undefined)).toEqual(CANONICAL);
    expect(orderPhotoSections([])).toEqual(CANONICAL);
  });

  it("always returns every section exactly once", () => {
    // The owner's strip and the tour both index this; a missing key would
    // silently drop a whole section of photos from the listing.
    expect(orderPhotoSections(["mess"])).toHaveLength(CANONICAL.length);
    expect(orderPhotoSections(["mess", "mess", "rooms"])).toEqual([
      "mess",
      "rooms",
      "bathrooms",
      "common",
      "study",
      "outside",
      "other",
    ]);
  });

  it("drops a key that is not a section", () => {
    expect(orderPhotoSections(["terrace", "rooms"] as any)).toEqual(CANONICAL);
  });
});
