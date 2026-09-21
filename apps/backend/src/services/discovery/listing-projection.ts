import { parseNavigation } from "./hostel-navigation";
import { summariseSpace } from "./room-space";
// The pure helper, not the service: that would pull `@/lib/db` into this graph.
import { fullName } from "../host-profile/bio-rules";
// Type-only — erased at runtime, so no database client enters this module.
import type { PublicHost } from "../host-profile/host-profile-service";

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
    owner_id?: string | null;
  };
  /** The marketing revision's validated content, or null when never approved. */
  marketing: any | null;
  /**
   * The owner's host card from `hostProfileService.getPublicHost` — hidden
   * fields already dropped. Null when it could not be read (or for a platform
   * listing); the projection then falls back to the bare name so a host-card
   * failure never takes a listing down.
   */
  hostProfile?: PublicHost | null;
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
 * "Ravi K." — the rule for a *review's author*: enough to read as a person,
 * never a full identity. Since ADR-200 host cards use the full name instead
 * (`fullName` in host-profile/bio-rules); this stays for reviewers.
 */
export function hostName(fullName: string | null | undefined): string | null {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/**
 * Each advertised bed type, with what the real rooms of that size are like to
 * live in. Attached here rather than left to the client so the "smaller room
 * wins" and "only claim what every room has" rules live in one place.
 */
export function bedTierSpace(bedTiers: any[], rooms: any[]) {
  return bedTiers.map((tier: any) => {
    const matching = (rooms ?? [])
      .filter((room: any) => Number(room.capacity) === Number(tier.sharing))
      .map((room: any) => ({ capacity: Number(room.capacity), ...(room.space ?? {}) }));
    return { ...tier, space: summariseSpace(matching) };
  });
}

export function projectListing({ detail, visible, marketing, hostProfile = null, preview = false }: ProjectListingInput) {
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
    bed_tiers: bedTierSpace(marketing?.beds ?? [], detail.rooms ?? []),

    amenities: (marketing?.amenities ?? []).filter((amenity: any) => amenity.enabled),
    places: marketing?.places ?? [],

    /**
     * How to find the front door, or null when nobody has located this hostel
     * yet. Parsed rather than passed through: a hand-edited row must degrade to
     * "no directions" instead of rendering a Get Directions button that opens
     * the wrong building. The Maps URL itself is built on the frontend from
     * `placeId` — deliberately never stored. See migration 074.
     */
    navigation: parseNavigation((visible as any).navigation),

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
     * Who runs this place — the "Meet your host" card (ADR-200).
     *
     * A listing with no human attached is a database row; every marketplace
     * that trades on trust puts a person on the page. Since ADR-200 that
     * person is named in full, with their photo, their own words and the
     * stats they earned — and still never a phone or email (the bio rules
     * refuse both). A PLATFORM_LISTED hostel has no real owner, so it says so
     * rather than naming the sentinel profile — unless its reviewed listing
     * content names a host (`basics.host_name`), which is shown as-is.
     */
    host: platformListed
      ? {
          platform_listed: true,
          // Only a name an admin-reviewed listing carries for this hostel —
          // never the shared sentinel profile's.
          name: marketing?.basics?.host_name?.trim() || null,
          photo_url: null,
          bio: null,
          languages: [],
          hosting_since: null,
          verified: false,
          listed_since: visible.created_at ?? null,
          stats: { review_count: 0, rating: null, residents: null },
        }
      : {
          platform_listed: false,
          name: hostProfile?.name ?? fullName(visible.owner?.name),
          photo_url: hostProfile?.photo_url ?? null,
          bio: hostProfile?.bio ?? null,
          languages: hostProfile?.languages ?? [],
          hosting_since: hostProfile?.hosting_since ?? null,
          verified: hostProfile?.verified ?? false,
          listed_since: hostProfile?.listed_since ?? visible.created_at ?? null,
          stats: hostProfile?.stats ?? { review_count: 0, rating: null, residents: null },
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

/**
 * The price a hostel actually advertises, from its approved marketing revision.
 *
 * ## Why this is not `min(rooms.base_rent)`
 *
 * Those are two different numbers and the card was quoting the wrong one.
 * `rooms.base_rent` is the **operational** rent — what the hostel bills the
 * people living there, room by room. The marketing revision's `beds[]` is the
 * **advertised** offer: the sharing options a seeker can actually choose from,
 * each with its own price, reviewed by an admin before it goes public.
 *
 * On Sunrise Residency every room is a 4-bed at ₹8,000 operationally, while the
 * approved listing offers 2-bed at ₹12,000, 4-sharing at ₹7,000 and a ground
 * floor 4-bed at ₹8,500. The card said "from ₹8,000" — higher than the
 * cheapest thing on sale, and a number appearing on no public page.
 *
 * **Available beds win.** Quoting the price of a bed type that is full is a
 * "from" nobody can take. If nothing is marked available the whole set is used
 * rather than dropping the price entirely, since the card shows availability
 * separately and a listing with no price is worse than one with a full one.
 *
 * Returns `null` when the revision prices nothing, so the caller can fall back
 * to the operational figure rather than rendering "Price on request" for a
 * hostel that does have rooms priced.
 */
export function advertisedStartingPrice(marketing: any | null): number | null {
  const beds = Array.isArray(marketing?.beds) ? marketing.beds : [];
  if (beds.length === 0) return null;

  const priceOf = (bed: any): number | null => {
    const price = Number(bed?.price ?? 0);
    // A bed with no price is unpriced, not free — quoting ₹0 would be a lie.
    return Number.isFinite(price) && price > 0 ? price : null;
  };

  const pick = (rows: any[]): number | null => {
    const prices = rows.map(priceOf).filter((price): price is number => price !== null);
    return prices.length > 0 ? Math.min(...prices) : null;
  };

  const available = beds.filter((bed: any) => String(bed?.availability ?? '').toUpperCase() === 'AVAILABLE');
  return pick(available) ?? pick(beds);
}

/**
 * Whether an approved listing says beds are open, with no live count behind it.
 *
 * Only meaningful for a hostel with no real rooms (a platform listing), where
 * the owner's `AVAILABLE` is the only vacancy signal there is. A card can then
 * say "Beds available" instead of "Fully booked" — a claim with no number,
 * because inventing one is exactly what a platform listing must not do.
 */
export function advertisesOpenBeds(marketing: any | null): boolean {
  const beds = Array.isArray(marketing?.beds) ? marketing.beds : [];
  return beds.some((bed: any) => String(bed?.availability ?? '').toUpperCase() === 'AVAILABLE');
}
