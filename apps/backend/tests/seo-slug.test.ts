/**
 * Slug rules. A slug is a permanent public address, so these are permanence
 * tests as much as formatting ones. ADR-226.
 */

import { describe, it, expect } from "vitest";
import {
  ID_FRAGMENT_LENGTH,
  buildAreaSlug,
  buildCollegeSlug,
  buildHostelSlug,
  isNormalisedSlug,
  normaliseSlug,
  slugifySegment,
} from "@/src/services/seo/slug";

describe("buildHostelSlug", () => {
  const hostel = {
    name: "Sri Adithya Boys Hostel",
    locality: "Yamnampet",
    id: "36094ab4-1302-47e2-96bf-f0cbf937389e",
  };

  it("produces the locality-suffixed form ADR-226 chose", () => {
    expect(buildHostelSlug(hostel)).toBe("sri-adithya-boys-hostel-yamnampet-36094ab4");
  });

  it("is deterministic — the same inputs always give the same address", () => {
    expect(buildHostelSlug(hostel)).toBe(buildHostelSlug({ ...hostel }));
  });

  it("omits the locality rather than inventing one when no area is assigned", () => {
    expect(buildHostelSlug({ ...hostel, locality: null })).toBe(
      "sri-adithya-boys-hostel-36094ab4",
    );
  });

  it("keeps the full id fragment even when the name is long enough to truncate", () => {
    const slug = buildHostelSlug({
      name: "A".repeat(200),
      locality: "B".repeat(100),
      id: "36094ab4-1302-47e2-96bf-f0cbf937389e",
    });
    expect(slug.endsWith("-36094ab4")).toBe(true);
    expect(slug.split("-").pop()).toHaveLength(ID_FRAGMENT_LENGTH);
  });

  it("distinguishes two same-named hostels in the same locality", () => {
    const a = buildHostelSlug({ ...hostel, id: "36094ab4-1111-1111-1111-111111111111" });
    const b = buildHostelSlug({ ...hostel, id: "aaaa0000-2222-2222-2222-222222222222" });
    expect(a).not.toBe(b);
  });

  it("survives a name made entirely of punctuation", () => {
    const slug = buildHostelSlug({ name: "!!! ???", locality: null, id: "36094ab41302" });
    expect(slug).toBe("hostel-36094ab4");
  });

  it("emits a slug that is already in canonical form", () => {
    expect(isNormalisedSlug(buildHostelSlug(hostel))).toBe(true);
  });
});

describe("normaliseSlug", () => {
  it("lowercases, so one hostel is not two indexable URLs", () => {
    expect(normaliseSlug("Sri-Adithya-Boys-Hostel-36094ab4")).toBe(
      "sri-adithya-boys-hostel-36094ab4",
    );
  });

  it("strips surrounding slashes and whitespace", () => {
    expect(normaliseSlug("  /sri-adithya/  ")).toBe("sri-adithya");
  });

  it("collapses repeated hyphens", () => {
    expect(normaliseSlug("sri--adithya---boys")).toBe("sri-adithya-boys");
  });

  it("is idempotent", () => {
    const once = normaliseSlug("/Sri--Adithya-/");
    expect(normaliseSlug(once)).toBe(once);
  });
});

describe("slugifySegment", () => {
  it("reduces any run of non-alphanumerics to one hyphen", () => {
    expect(slugifySegment("Sreenidhi  Institute & Tech.")).toBe("sreenidhi-institute-tech");
  });

  it("never leaves a trailing hyphen after truncation", () => {
    expect(slugifySegment("a".repeat(59) + " b", 60).endsWith("-")).toBe(false);
  });
});

describe("area and college slugs carry no id fragment", () => {
  it("names an area by its name alone — it is curated, not minted", () => {
    expect(buildAreaSlug("Yamnampet")).toBe("yamnampet");
    expect(buildAreaSlug("Ghatkesar")).toBe("ghatkesar");
  });

  it("prefers a college's short name, which is what a student types", () => {
    expect(
      buildCollegeSlug({
        shortName: "SNIST",
        name: "Sreenidhi Institute of Science and Technology",
      }),
    ).toBe("snist");
  });

  it("falls back to the full name when there is no short name", () => {
    expect(buildCollegeSlug({ shortName: null, name: "JNTU Hyderabad" })).toBe("jntu-hyderabad");
  });
});
