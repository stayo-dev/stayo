import { describe, it, expect } from "vitest";
import {
  REVIEW_SECTIONS,
  normaliseReviewFlags,
  summariseFlagsForOwner,
  isSendBackActionable,
} from "@/src/services/marketing/review-flags";

const ADMIN = "11111111-1111-1111-1111-111111111111";

describe("REVIEW_SECTIONS", () => {
  it("covers exactly the sections a marketing page has", () => {
    expect([...REVIEW_SECTIONS].sort()).toEqual(
      ["amenities", "basics", "beds", "mess", "photos", "places"],
    );
  });
});

describe("normaliseReviewFlags", () => {
  it("keeps well-formed flags and stamps who and when", () => {
    const out = normaliseReviewFlags([{ section: "photos", note: "3 are blurry" }], ADMIN);
    expect(out).toHaveLength(1);
    expect(out[0].section).toBe("photos");
    expect(out[0].note).toBe("3 are blurry");
    expect(out[0].flagged_by).toBe(ADMIN);
    expect(typeof out[0].flagged_at).toBe("string");
  });

  it("drops a flag naming a section that does not exist", () => {
    expect(normaliseReviewFlags([{ section: "pricing", note: "x" }], ADMIN)).toEqual([]);
  });

  it("keeps a flag with no note — pointing at the section is still information", () => {
    const out = normaliseReviewFlags([{ section: "mess" }], ADMIN);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBeNull();
  });

  it("collapses duplicate flags on one section to the last one", () => {
    const out = normaliseReviewFlags(
      [{ section: "beds", note: "first" }, { section: "beds", note: "second" }],
      ADMIN,
    );
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe("second");
  });

  it("tolerates junk input rather than throwing", () => {
    expect(normaliseReviewFlags(null as any, ADMIN)).toEqual([]);
    expect(normaliseReviewFlags([null, 5, "x"] as any, ADMIN)).toEqual([]);
  });

  it("trims and caps a long note", () => {
    const out = normaliseReviewFlags([{ section: "basics", note: "  " + "x".repeat(3000) }], ADMIN);
    expect(out[0].note!.length).toBeLessThanOrEqual(1000);
  });
});

describe("isSendBackActionable", () => {
  // ADR-076 established that a reasonless "no" just produces a resubmission of
  // the same page. At section granularity that still holds.
  it("rejects a send-back with neither flags nor a note", () => {
    expect(isSendBackActionable([], "")).toBe(false);
    expect(isSendBackActionable([], "   ")).toBe(false);
  });

  it("accepts a note alone", () => {
    expect(isSendBackActionable([], "Photos need reshooting")).toBe(true);
  });

  it("accepts a flag alone — the section itself is the instruction", () => {
    expect(isSendBackActionable(normaliseReviewFlags([{ section: "photos" }], ADMIN), "")).toBe(true);
  });
});

describe("summariseFlagsForOwner", () => {
  it("names each flagged section in words the owner will recognise", () => {
    const flags = normaliseReviewFlags(
      [{ section: "photos", note: "blurry" }, { section: "mess", note: "Sunday empty" }],
      ADMIN,
    );
    const text = summariseFlagsForOwner(flags);
    expect(text).toContain("Photos");
    expect(text).toContain("blurry");
    expect(text).toContain("Mess menu");
    expect(text).toContain("Sunday empty");
  });

  it("returns an empty string when nothing was flagged, so callers can fall back to the note", () => {
    expect(summariseFlagsForOwner([])).toBe("");
  });

  it("names a section even when it carries no note", () => {
    const flags = normaliseReviewFlags([{ section: "amenities" }], ADMIN);
    expect(summariseFlagsForOwner(flags)).toContain("Amenities");
  });
});
