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
    created_at?: Date | string | null;
    owner?: { name?: string | null } | null;
  };
  /** The marketing revision's validated content, or null when never approved. */
  marketing: any | null;
  /** True when serving an unapproved revision to an admin. */
  preview?: boolean;
};

/**
 * Which photos a hostel shows, in one place.
 *
 * Approved marketing photos win over the admissions gallery — those are the
 * ones a human reviewed for this surface — and the **cover comes first**.
 * `marketing-content.ts` already guarantees exactly one `is_cover` per
 * revision precisely so that Discovery can lead with it; nothing was reading
 * the flag, so the hero and the search card both showed whichever photo
 * happened to sort first.
 *
 * Shared with `discovery-service`'s card projection, which used to read only
 * `hostels.admission_photos` and therefore showed the placeholder texture for
 * every hostel whose photos arrived through the marketing review flow (which
 * is all of them — nothing populates `admission_photos`). See [[Bugs]].
 */
export function listingPhotos(marketing: any | null, fallback: string[] = []): string[] {
  const photos = Array.isArray(marketing?.photos) ? [...marketing.photos] : [];
  const urls = photos
    // Two keys, in order: the cover leads, everything else keeps the owner's
    // arrangement. Array#sort is stable, so equal ranks do not get shuffled.
    .sort((a: any, b: any) => {
      const cover = Number(Boolean(b?.is_cover)) - Number(Boolean(a?.is_cover));
      if (cover !== 0) return cover;
      return Number(a?.sort ?? 0) - Number(b?.sort ?? 0);
    })
    .map((photo: any) => photo?.url)
    .filter((url: unknown): url is string => typeof url === "string" && url.length > 0);

  return urls.length > 0 ? urls : fallback;
}

export interface ListingMedia {
  url: string;
  kind: "image" | "video";
  thumbnail_url: string | null;
  label: string | null;
  /** Which part of the hostel this shows — groups the photo tour. */
  category: string;
}

/**
 * The gallery as the listing page renders it — same order and same source as
 * `listingPhotos`, but keeping each item's kind. Everything without an
 * explicit kind is an image: every revision written before video existed says
 * nothing on the subject, and those are all photos.
 */
export function listingMedia(marketing: any | null, fallback: string[] = []): ListingMedia[] {
  const photos = Array.isArray(marketing?.photos) ? [...marketing.photos] : [];
  const ordered = photos
    .sort((a: any, b: any) => {
      const cover = Number(Boolean(b?.is_cover)) - Number(Boolean(a?.is_cover));
      if (cover !== 0) return cover;
      return Number(a?.sort ?? 0) - Number(b?.sort ?? 0);
    })
    .filter((photo: any) => typeof photo?.url === "string" && photo.url.length > 0)
    .map((photo: any) => ({
      url: photo.url as string,
      kind: (photo.kind === "video" ? "video" : "image") as "image" | "video",
      thumbnail_url: typeof photo.thumbnail_url === "string" ? photo.thumbnail_url : null,
      label: typeof photo.label === "string" ? photo.label : null,
      category: typeof photo.category === "string" ? photo.category : "other",
    }));

  if (ordered.length > 0) return ordered;
  return fallback.map((url) => ({
    url,
    kind: "image" as const,
    thumbnail_url: null,
    label: null,
    category: "other",
  }));
}

/**
 * "Ravi K." — the owner as a public listing names them. Same rule as a review
 * author: enough to read as a person, never a full identity beside a business
 * a stranger can walk into.
 */
export function hostName(fullName: string | null | undefined): string | null {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

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
      photos: listingPhotos(marketing, detail.hostel.photos ?? []),
      /**
       * The gallery with its kinds intact, so the listing can render a video
       * as a video. `photos` stays a plain URL list beside it: several
       * surfaces (and the share preview's og:image) only ever want stills,
       * and widening that field would have made every one of them handle a
       * clip they cannot display.
       */
      media: listingMedia(marketing, detail.hostel.photos ?? []),
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
    /**
     * Who runs this place, and since when.
     *
     * A listing with no human attached is a database row; every marketplace
     * that trades on trust puts a person on the page. First name and last
     * initial only — the same rule as a review's author (`reviewerDisplayName`)
     * — and nothing else: no phone, no email. A PLATFORM_LISTED hostel has no
     * real owner, so it says so rather than naming the sentinel profile.
     */
    host: platformListed
      ? { name: null, listed_since: visible.created_at ?? null, platform_listed: true }
      : {
          name: hostName(visible.owner?.name),
          listed_since: visible.created_at ?? null,
          platform_listed: false,
        },

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
