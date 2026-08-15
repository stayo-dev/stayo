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

/**
 * The weekly mess menu, as the design's "Mess menu" card edits it and the
 * Discovery listing's "Food & mess" section renders it.
 *
 * This lives in reviewed marketing content rather than reading the operational
 * `food_schedules` tables on purpose. A food schedule is a tenant-ops artifact:
 * it is regenerated monthly, can be driven by resident polls, and changes
 * whenever the owner reworks next month's plan. A published listing is a claim
 * Stayo has reviewed and lent its name to. Wiring the listing straight to the
 * schedule would let the menu a tenant sees before moving in change without any
 * review, and would tie a *marketing* promise to a month that may not exist yet.
 * So the listing carries its own reviewed copy of the menu. See ADR-077.
 */
const MessMealSchema = z.object({
  /** Fixed keys — `week` rows are indexed by these. */
  key: z.enum(["b", "l", "s", "dn"]),
  label: z.string().trim().min(1).max(24),
  /** "7:30 – 9:00 AM". Free text, because serving times are not a schedule. */
  time: z.string().trim().max(32),
  /** Off means the hostel does not serve that meal at all. */
  enabled: z.boolean().default(true),
});

const MessDaySchema = z.object({
  b: z.string().trim().max(200).default(""),
  l: z.string().trim().max(200).default(""),
  s: z.string().trim().max(200).default(""),
  dn: z.string().trim().max(200).default(""),
});

const MessSchema = z.object({
  /** The card's toggle. Off publishes "Meals not provided" on the listing. */
  provided: z.boolean().default(false),
  type: z.enum(["VEG", "NON_VEG", "BOTH"]).default("VEG"),
  meals: z.array(MessMealSchema).max(4).default([]),
  /** Mon–Sun. Always exactly 7 rows after `normaliseContent`. */
  week: z.array(MessDaySchema).max(7).default([]),
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
  mess: MessSchema.default({}),
});

export type MarketingContent = z.infer<typeof MarketingContentSchema>;

/**
 * The four meals the design lays out, with its serving times. Owners edit the
 * dishes and can switch a meal off, but the set itself is fixed — a listing
 * where one hostel invents a fifth meal stops being comparable in search.
 */
export const DEFAULT_MESS_MEALS: MarketingContent["mess"]["meals"] = [
  { key: "b", label: "Breakfast", time: "7:30 – 9:00 AM", enabled: true },
  { key: "l", label: "Lunch", time: "12:30 – 2:00 PM", enabled: true },
  { key: "s", label: "Snacks", time: "5:00 – 6:00 PM", enabled: true },
  { key: "dn", label: "Dinner", time: "8:00 – 9:30 PM", enabled: true },
];

const EMPTY_MESS_DAY = { b: "", l: "", s: "", dn: "" };

export const EMPTY_CONTENT: MarketingContent = {
  basics: { tagline: null, about: null, highlights: [] },
  photos: [],
  beds: [],
  amenities: [],
  places: [],
  mess: {
    provided: false,
    type: "VEG",
    meals: DEFAULT_MESS_MEALS,
    week: Array.from({ length: 7 }, () => ({ ...EMPTY_MESS_DAY })),
  },
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

  // The mess menu is indexed positionally by both surfaces — the owner's day
  // chips and Discovery's day chips both read `week[dayIndex]`. A revision
  // saved with fewer than 7 days (or none at all, which every revision written
  // before the mess block existed is) must not make Tuesday read `undefined`,
  // so the week is padded to exactly 7 and the meal set restored to the fixed
  // four rather than left short.
  const messMeals = DEFAULT_MESS_MEALS.map((fallback) => {
    const saved = content.mess.meals.find((meal) => meal.key === fallback.key);
    return saved ?? fallback;
  });
  const messWeek = Array.from({ length: 7 }, (_unused, index) => ({
    ...EMPTY_MESS_DAY,
    ...(content.mess.week[index] ?? {}),
  }));

  return {
    ...content,
    photos: normalisedPhotos,
    beds: [...content.beds].sort((a, b) => a.sharing - b.sharing),
    places: [...content.places].sort((a, b) => a.sort - b.sort).map((place, index) => ({ ...place, sort: index })),
    mess: { ...content.mess, meals: messMeals, week: messWeek },
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
