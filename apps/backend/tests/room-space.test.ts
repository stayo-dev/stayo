import { describe, it, expect } from "vitest";
import {
  dimensionLabel,
  perBedArea,
  spaceAnchor,
  storageLines,
  summariseSpace,
} from "@/src/services/discovery/room-space";

const room = (over: Record<string, unknown> = {}) => ({
  capacity: 4,
  length_ft: 14,
  width_ft: 10,
  cupboard_per_bed: true,
  under_bed_storage: "LARGE_SUITCASE",
  study_desk: "PER_BED",
  windows: 2,
  ...over,
}) as any;

describe("perBedArea", () => {
  it("divides the floor between the beds — the number nobody publishes", () => {
    // The same 140 sq ft room is a different life at 4 and at 6 sharing.
    expect(perBedArea(14, 10, 4)).toBe(35);
    expect(perBedArea(14, 10, 6)).toBe(23);
  });

  it("says nothing when the room was never measured", () => {
    expect(perBedArea(null, 10, 4)).toBeNull();
    expect(perBedArea(14, null, 4)).toBeNull();
  });

  it("refuses a nonsense capacity rather than dividing by zero", () => {
    expect(perBedArea(14, 10, 0)).toBeNull();
  });
});

describe("dimensionLabel", () => {
  it("shows the owner's two measurements, not a derived area", () => {
    expect(dimensionLabel(11, 13)).toBe("11 × 13 ft");
    expect(dimensionLabel(11.5, 13)).toBe("11.5 × 13 ft");
  });

  it("is absent when either measurement is", () => {
    expect(dimensionLabel(null, 13)).toBeNull();
  });
});

describe("spaceAnchor", () => {
  it("says what a tight room is, rather than flattering it", () => {
    // A listing that calls 18 sq ft "cosy" is why people distrust listings.
    expect(spaceAnchor(18)).toMatch(/tight/i);
  });

  it("bands the rest honestly", () => {
    expect(spaceAnchor(30)).toMatch(/average/i);
    expect(spaceAnchor(45)).toMatch(/roomy/i);
    expect(spaceAnchor(80)).toMatch(/spacious/i);
  });

  it("says nothing without a measurement", () => {
    expect(spaceAnchor(null)).toBeNull();
  });
});

describe("storageLines", () => {
  it("counts objects instead of using adjectives", () => {
    expect(storageLines(room())).toEqual([
      "One lockable cupboard per person",
      "A large suitcase fits under each bed",
      "A study desk for every bed",
    ]);
  });

  it("omits what the room does not have rather than saying 'none'", () => {
    expect(storageLines(room({ under_bed_storage: "NONE", study_desk: "NONE" })))
      .toEqual(["One lockable cupboard per person"]);
  });

  it("distinguishes shared cupboards from per-person ones", () => {
    expect(storageLines(room({ cupboard_per_bed: false }))[0]).toBe("Shared cupboard space");
  });

  it("says nothing at all when nothing was recorded", () => {
    expect(storageLines({ capacity: 4 } as any)).toEqual([]);
  });
});

describe("summariseSpace", () => {
  it("summarises one measured room", () => {
    const space = summariseSpace([room()])!;
    expect(space.dimensions).toBe("14 × 10 ft");
    expect(space.perBedArea).toBe(35);
    expect(space.varies).toBe(false);
    expect(space.windows).toBe(2);
  });

  it("returns nothing when no room of this size was measured", () => {
    expect(summariseSpace([{ capacity: 4 } as any])).toBeNull();
    expect(summariseSpace([])).toBeNull();
  });

  it("says rooms differ instead of averaging them into a fiction", () => {
    const space = summariseSpace([room(), room({ length_ft: 20, width_ft: 12 })])!;
    expect(space.varies).toBe(true);
    expect(space.dimensions).toBe("35–60 sq ft per bed");
  });

  it("promises the smaller room when they differ", () => {
    // The claim a listing makes should be one every room of that size keeps.
    expect(summariseSpace([room(), room({ length_ft: 20, width_ft: 12 })])!.perBedArea).toBe(35);
  });

  it("only claims storage true of every room of this size", () => {
    const space = summariseSpace([room(), room({ under_bed_storage: "NONE" })])!;
    expect(space.storage).toEqual(["One lockable cupboard per person", "A study desk for every bed"]);
  });

  it("withholds the window count when rooms disagree", () => {
    expect(summariseSpace([room(), room({ windows: 1 })])!.windows).toBeNull();
  });

  it("ignores unmeasured rooms rather than treating them as zero", () => {
    expect(summariseSpace([room(), { capacity: 4 } as any])!.perBedArea).toBe(35);
  });
});
