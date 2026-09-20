/**
 * The shapes the SEO generators read.
 *
 * PURE MODULE — types and nothing else.
 *
 * WHY A SEPARATE FACT SHAPE rather than passing `projectListing`'s output
 * around: the generators must be testable without a database, and they must be
 * impossible to feed a field that no column backs. Mapping the live listing
 * into this narrow shape happens once, in `seo-service.ts`, and every rule
 * about what a page may claim is then enforced by the type system — if a fact
 * is not on this interface, no page can say it. ADR-226.
 */

export interface BedTierFact {
  /** Owner-authored label, e.g. "Ground floor 4-bed". */
  name: string | null;
  /** Beds in the room. 1 = single. */
  sharing: number;
  /** Rupees per month, or null when the owner has not priced it. */
  price: number | null;
  /** `AVAILABLE` | `BEDS_LEFT` | `FULL`, as approved. */
  availability: string | null;
  /** Human summary of the physical room, when measured. Null is normal. */
  space: string | null;
}

export interface CollegeFact {
  name: string;
  shortName: string | null;
  slug: string;
  /** Free text — "400 m", "5 min walk". Never parsed into a number. */
  distanceText: string | null;
  /**
   * Whether the college's own page is live. A hostel always NAMES its nearest
   * campus in its copy — that is true regardless — but only links to
   * `/hostels-near/:slug` once an admin has published it, so the internal
   * graph never contains a link into a 404.
   */
  published?: boolean;
}

export interface PlaceFact {
  name: string;
  distance: string | null;
  category: string | null;
}

export interface MessFact {
  /** `VEG` | `NON_VEG` | `BOTH`. */
  type: string | null;
  meals: { key: string; label: string; time: string | null }[];
  /** Seven rows of `{ b, l, s, dn }`, as approved. */
  week: Record<string, string | null>[];
}

export interface ReviewFact {
  /** 1–5, database-constrained. */
  rating: number;
  body: string | null;
  /** First name + last initial, or "A resident" — never a full name. */
  author: string;
  /** "8 months", when the resident said. Null is normal. */
  stayDuration: string | null;
  stayedHere: boolean;
  createdAt: string | null;
}

export interface HostFact {
  name: string | null;
  hostingSince: string | null;
  languages: string[];
  verified: boolean;
  platformListed: boolean;
}

/**
 * Everything a hostel page is allowed to say about a hostel.
 *
 * Note what is NOT here and cannot be added without a column to back it:
 * a star rating that no review produced, a distance nobody measured, a
 * "popular"/"best" claim, or a phone number (not public on any Stayo surface).
 */
export interface HostelFacts {
  id: string;
  slug: string;
  name: string;

  /** The curated locality, when one is assigned. Falls back to `city`. */
  areaName: string | null;
  areaSlug: string | null;
  /**
   * The locality's parent — Ghatkesar for a hostel in Yamnampet.
   *
   * This is what `addressLocality` becomes. Google reads a concatenated
   * "Yamnampet,Ghatkesar" as one unknown string rather than two places it
   * already knows, which is why the two are modelled apart.
   */
  parentAreaName: string | null;
  parentAreaSlug: string | null;
  city: string | null;
  cityAreaSlug: string | null;
  state: string | null;
  address: string | null;
  /** Every ancestor, nearest first: [Yamnampet, Ghatkesar, Hyderabad]. */
  areaAncestry: { name: string; slug: string; kind: string; published?: boolean }[];

  /** `BOYS` | `GIRLS` | `CO_LIVING` | `WORKING_PROS` | null. */
  hostelType: string | null;
  foodIncluded: boolean;
  verified: boolean;

  /** The advertised "from" price. Null means "Price on request", never ₹0. */
  startingPrice: number | null;
  /** Distinct room capacities actually on offer, ascending. */
  sharing: number[];
  bedTiers: BedTierFact[];

  tagline: string | null;
  about: string | null;
  highlights: string[];
  amenities: string[];

  /** Cover first. Already ImageKit URLs; transformed at render time. */
  photos: string[];

  /**
   * Live vacancy, and whether it can be trusted. A PLATFORM_LISTED hostel has
   * no real rooms, so `availabilityConfirmed` is false and no page may state
   * or imply a bed count for it.
   */
  vacantBeds: number | null;
  availabilityConfirmed: boolean;
  platformListed: boolean;

  colleges: CollegeFact[];
  places: PlaceFact[];
  mess: MessFact | null;
  host: HostFact | null;

  /** Present only when an admin has located the hostel. */
  navigation: { landmark: string | null; referenceName: string | null; distance: string | null } | null;

  /**
   * THIS HOSTEL's published reviews — never the host's, and never a count
   * borrowed from anywhere else. 0 until one is published, which is what
   * gates `aggregateRating` entirely.
   */
  reviewCount: number;
  rating: number | null;
  /** The reviews the page actually renders. Structured data may not claim a
   *  rating the reader cannot see, so these travel together. */
  reviews: ReviewFact[];

  /** Real row timestamps — used for `lastmod`, never `new Date()`. */
  updatedAt: Date | string | null;
}

/** A hostel as it appears in a list on a collection page. */
export interface ListingCardFact {
  slug: string;
  name: string;
  areaName: string | null;
  city: string | null;
  hostelType: string | null;
  startingPrice: number | null;
  sharing: number[];
  foodIncluded: boolean;
  photo: string | null;
  vacantBeds: number | null;
  availabilityConfirmed: boolean;
  /** Only set on a college page, from `hostel_colleges.distance_text`. */
  distanceText?: string | null;
}

/** The dimension a collection page is built on. */
export interface CollectionSubject {
  kind: "area" | "city" | "college" | "intent";
  slug: string;
  name: string;
  shortName?: string | null;
  /** Admin-written editorial. Null is normal and renders nothing. */
  intro: string | null;
  /** For a locality: its city. For a college: the area it sits in. */
  parentName?: string | null;
  parentSlug?: string | null;
  state?: string | null;
}

/** Aggregates computed from the listings on a collection page. */
export interface CollectionStats {
  listingCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  /** Distinct capacities across the set, ascending. */
  sharing: number[];
  withFood: number;
  withVacancy: number;
  /** Distinct `hostel_type` values present. */
  types: string[];
}

export interface SeoLink {
  href: string;
  label: string;
}

export interface Breadcrumb {
  name: string;
  /** Absolute URL. The last crumb (the current page) still carries its own. */
  url: string;
}
