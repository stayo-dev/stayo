import { z } from "zod";

/**
 * The shape of a hostel's Discovery listing content, ported from the
 * `HOSTEL: MARKETING` section of `Stayo App.dc.html`.
 *
 * This is the contract that keeps `hostel_marketing_revisions.content` a
 * checked payload rather than free-form JSON. It is validated on the way in
 * (owner save) **and** on the way out (before Discovery renders it), because a
 * revision approved under an older shape must not crash a public page — an
 * unparseable revision degrades to "no marketing content" rather than a 500.
 *
 * Deliberately absent: **reviews**. The design marks them "Managed by Stayo —
 * owners can't add, edit or remove reviews", and that is a trust property, not
 * a layout choice. There is no field here for an owner to write one.
 */

/** Rooms carry the real inventory; this describes the *offer* around it. */
const BedTierSchema = z.object({
  /** Owner's name for the tier, e.g. "4-Bed AC". */
  name: z.string().trim().min(1).max(60),
  /** Beds per room. Matched against real `rooms.capacity` at render time. */
  sharing: z.number().int().min(1).max(20),
  /** Advertised monthly price per bed, in whole rupees. */
  price: z.number().int().min(0).max(1_000_000),
  /** "Attached bath · study desk · locker" — free text shown under the tier. */
  inclusions: z.string().trim().max(200).optional().nullable(),
  /**
   * How availability is expressed for this tier. `BEDS_LEFT` shows the live
   * count from real rooms; the other two are owner assertions.
   */
  availability: z.enum(["BEDS_LEFT", "AVAILABLE", "FULL"]).default("BEDS_LEFT"),
});

const PhotoSchema = z.object({
  url: z.string().url(),
  /** Shown over the photo, e.g. "hostel · common area". */
  label: z.string().trim().max(80).optional().nullable(),
  /** Exactly one photo is the cover — enforced in `normaliseContent`. */
  is_cover: z.boolean().default(false),
  sort: z.number().int().min(0).max(200).default(0),
});

const AmenitySchema = z.object({
  label: z.string().trim().min(1).max(50),
  /**
   * The design's amenity chips toggle on and off rather than being deleted, so
   * an owner can hide one without losing it. Only enabled amenities are
   * published.
   */
  enabled: z.boolean().default(true),
  /** Optional icon key; unknown keys fall back to a generic glyph. */
  icon: z.string().trim().max(30).optional().nullable(),
});

const PlaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** "400 m", "2.1 km" — free text, because owners measure in both. */
  distance: z.string().trim().max(24),
  category: z.enum(["COLLEGE", "TRANSPORT", "MARKET", "HOSPITAL", "OTHER"]).default("OTHER"),
  sort: z.number().int().min(0).max(100).default(0),
});

const BasicsSchema = z.object({
  /**
   * One line under the hostel name in Discovery.
   *
   * `.default(null)` rather than bare `.optional()` so the parsed shape always
   * carries the key. Without it, empty content parsed from `{}` and
   * `EMPTY_CONTENT` were structurally different objects, and a consumer
   * reading `basics.tagline` got `undefined` on one path and `null` on the
   * other.
   */
  tagline: z.string().trim().max(120).nullable().default(null),
  about: z.string().trim().max(2000).nullable().default(null),
  /** Owner-stated, shown as-is. Not a substitute for the agreement's rules. */
  highlights: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
});

export const MarketingContentSchema = z.object({
  basics: BasicsSchema.default({ highlights: [] }),
  photos: z.array(PhotoSchema).max(24).default([]),
  beds: z.array(BedTierSchema).max(12).default([]),
  amenities: z.array(AmenitySchema).max(40).default([]),
  places: z.array(PlaceSchema).max(20).default([]),
});

export type MarketingContent = z.infer<typeof MarketingContentSchema>;

export const EMPTY_CONTENT: MarketingContent = {
  basics: { tagline: null, about: null, highlights: [] },
  photos: [],
  beds: [],
  amenities: [],
  places: [],
};

/**
 * Parse-and-repair, used on both the write and the read path.
 *
 * On the read path it must never throw: a revision approved under an older
 * shape would otherwise take down a public listing. An unparseable revision
 * degrades to empty content, which renders as "the owner hasn't published
 * details yet" — the same state a hostel with no marketing page shows.
 */
export function normaliseContent(raw: unknown): MarketingContent {
  const parsed = MarketingContentSchema.safeParse(raw ?? {});
  if (!parsed.success) return EMPTY_CONTENT;

  const content = parsed.data;

  // Exactly one cover. The design's Discovery search shows the cover photo
  // first, so "none" and "three" are both broken states rather than variations.
  const photos = [...content.photos].sort((a, b) => a.sort - b.sort);
  const coverIndex = photos.findIndex((photo) => photo.is_cover);
  const normalisedPhotos = photos.map((photo, index) => ({
    ...photo,
    is_cover: index === (coverIndex === -1 ? 0 : coverIndex),
    sort: index,
  }));

  return {
    ...content,
    photos: normalisedPhotos,
    beds: [...content.beds].sort((a, b) => a.sharing - b.sharing),
    places: [...content.places].sort((a, b) => a.sort - b.sort).map((place, index) => ({ ...place, sort: index })),
  };
}

/**
 * What a reviewer must be shown before approving, and what an owner must fix
 * before submitting.
 *
 * These are the claims a listing makes that Stayo is lending its name to, so
 * they are checked rather than trusted — an empty listing is not "minimal",
 * it is a hostel asking to be discovered while telling a tenant nothing.
 */
export function contentIssues(content: MarketingContent): string[] {
  const issues: string[] = [];

  if (content.photos.length === 0) {
    issues.push("Add at least one photo — Discovery shows a cover image on every card.");
  }
  if (content.beds.length === 0) {
    issues.push("Add at least one bed type, so tenants know what they can ask for.");
  }
  if (content.beds.some((bed) => bed.price <= 0)) {
    issues.push("Every bed type needs a monthly price. A ₹0 price reads as free, not as unpriced.");
  }
  if (!content.basics.tagline?.trim()) {
    issues.push("Add a one-line tagline — it sits under your hostel name in search.");
  }

  return issues;
}
