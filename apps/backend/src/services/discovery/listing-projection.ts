/**
 * The one projection from stored content to a Discovery listing payload.
 *
 * Extracted from `discovery-service.getListing()` so that the admin's
 * marketing PREVIEW and the live public listing run the same code. A separate
 * preview renderer would drift, and the moment it did, the admin would be
 * approving something other than what ships.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type ProjectListingInput = {
  /** `admissionsService.getPublicHostel(slug)` — rooms, address, real inventory. */
  detail: any;
  /** The `hostels` row fields Discovery merges on top. */
  visible: {
    id: string;
    hostel_type?: unknown;
    food_included?: unknown;
    listing_source?: string | null;
  };
  /** The marketing revision's validated content, or null when never approved. */
  marketing: any | null;
  /** True when serving an unapproved revision to an admin. */
  preview?: boolean;
};

export function projectListing({ detail, visible, marketing, preview = false }: ProjectListingInput) {
  const platformListed = String(visible.listing_source ?? "OWNER_MANAGED") === "PLATFORM_LISTED";

  return {
    ...detail,
    hostel: {
      ...detail.hostel,
      hostel_type: visible.hostel_type,
      food_included: visible.food_included,
      tagline: marketing?.basics?.tagline ?? null,
      about: marketing?.basics?.about ?? null,
      highlights: marketing?.basics?.highlights ?? [],
      // Owner-published photos win over the admissions gallery when they
      // exist — those are the ones a human approved for this surface.
      photos:
        marketing && marketing.photos?.length > 0
          ? marketing.photos.map((photo: any) => photo.url)
          : detail.hostel.photos,
    },

    /**
     * The advertised offer. For an OWNER_MANAGED hostel, live vacancy still
     * comes from real rooms — a marketing tier describes what is on sale, it
     * does not decide what is free.
     */
    bed_tiers: marketing?.beds ?? [],

    amenities: (marketing?.amenities ?? []).filter((amenity: any) => amenity.enabled),
    places: marketing?.places ?? [],

    /**
     * The reviewed weekly mess menu, or null when this hostel does not serve
     * meals. Null rather than an empty menu so the listing hides the section
     * outright — "Food & mess" with nothing under it reads as missing data,
     * not as a hostel that does not feed you.
     */
    mess: marketing?.mess?.provided
      ? { ...marketing.mess, meals: marketing.mess.meals.filter((meal: any) => meal.enabled) }
      : null,

    /**
     * Nobody operates a PLATFORM_LISTED hostel inside Stayo, so it has no real
     * `rooms` and its bed tiers are an advertised claim rather than inventory.
     * Consumers MUST NOT render a live vacancy count when this is false —
     * doing so advertises beds nobody can honour, to someone trying to find
     * somewhere to live. This is the single most important flag here.
     */
    availability_confirmed: !platformListed,
    platform_listed: platformListed,

    ratings_available: false,
    amenities_available: Boolean(marketing && marketing.amenities?.some((a: any) => a.enabled)),
    /** False when this hostel has never had a listing approved. */
    marketing_published: Boolean(marketing),
    /** True only when an admin is previewing an unapproved revision. */
    preview,
  };
}
