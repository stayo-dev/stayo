import { unstable_cache } from "next/cache";

import { prisma } from "@/lib/db";
import { discoveryService, DISCOVERABLE } from "@/src/services/discovery/discovery-service";
import { reviewsService } from "@/src/services/discovery/reviews-service";
import { advertisedStartingPrice } from "@/src/services/discovery/listing-projection";
import { seoTags } from "@/lib/cache/public-listing-cache";
import { buildCollegeSlug } from "./slug";
import { hostelPageSpec, type SeoPageSpec } from "./page-spec";
import type { CollegeFact, HostelFacts, ReviewFact } from "./types";

/**
 * The only module in the SEO engine that touches a database.
 *
 * ## It composes, it does not re-query
 *
 * `loadHostelPage` calls `discoveryService.getListing`, which already composes
 * `admissionsService.getPublicHostel` (live vacancy), the approved marketing
 * revision, `readNavigationSafely` and the host card. Re-deriving any of that
 * here would be a second implementation of rules that have already drifted
 * apart once in this codebase — the pattern the repo settled on is a read
 * model that composes existing services rather than recalculating.
 *
 * Crucially, the visibility gate is reached THROUGH `getListing`, so the SEO
 * page and the app's listing page cannot disagree about which hostels are
 * public. ADR-073 made `DISCOVERABLE` one exported constant after a detail
 * route grew its own gate and stayed reachable by direct URL after an admin
 * had suspended the hostel. A new indexable surface with its own copy of that
 * rule would be the same bug with a bigger blast radius.
 *
 * ## Caching
 *
 * `unstable_cache` with tags from `public-listing-cache.ts` and a one-hour
 * ceiling. The ceiling is the backstop: if a write path ever forgets to
 * invalidate, a page is wrong for an hour rather than indefinitely.
 *
 * See ADR-224.
 */

const PAGE_REVALIDATE_SECONDS = 3600;

/** Rupees, from the advertised offer, falling back to the operational figure. */
function resolveStartingPrice(listing: any): number | null {
  const marketing = {
    beds: (listing?.bed_tiers ?? []).map((tier: any) => ({
      price: tier?.price,
      availability: tier?.availability,
    })),
  };

  // Same precedence as `getShareCard`: the advertised price wins, so the
  // number in the JSON-LD `Offer`, the number in the title and the number the
  // page prints are one number. These have disagreed in production before.
  return advertisedStartingPrice(marketing) ?? listing?.hostel?.starting_price ?? null;
}

/**
 * Distinct room capacities, ascending.
 *
 * READ FROM REAL ROOMS, not from the marketing revision's bed tiers — the
 * same source `summariseRooms` uses for the search card and the share card.
 *
 * This matters because search FILTERS on rooms: `sharing=1` compiles to
 * `rooms.some.capacity in [1]`. Sri Adithya has single, 2-bed and 4-bed rooms
 * but only prices 4-bed tiers in its approved revision, so a tier-derived list
 * would have this page say "4-bed" to a reader who reached it by filtering for
 * a single room — the card promising one thing and the page it links to
 * saying another. Prices still come from the tiers (that is the advertised
 * offer, ADR-076); this is the inventory, which is a different question.
 *
 * Falls back to the tiers only if a listing somehow has no rooms at all, which
 * is the PLATFORM_LISTED case.
 */
function resolveSharing(listing: any): number[] {
  const capacities = new Set<number>();

  for (const room of listing?.rooms ?? []) {
    const value = Number(room?.capacity);
    if (Number.isFinite(value) && value > 0) capacities.add(value);
  }

  if (capacities.size === 0) {
    for (const tier of listing?.bed_tiers ?? []) {
      const value = Number(tier?.sharing);
      if (Number.isFinite(value) && value > 0) capacities.add(value);
    }
  }

  return Array.from(capacities).sort((a, b) => a - b);
}

/**
 * The colleges a hostel is near.
 *
 * PHASE 1 SOURCE: `hostels.navigation`, which carries an admin-entered
 * `referenceName` ("SNIST") and a free-text `distanceFromReference` ("400").
 * That is the only college data that exists today — there is no `colleges`
 * table yet (Phase 3 adds one). The slug is derived rather than stored, and
 * nothing links to it until the college page passes its own gate, so a derived
 * slug cannot produce a broken link.
 *
 * `content.places[]` is read too, for entries the owner categorised COLLEGE.
 * Both are owner/admin-authored strings; neither is invented here.
 */
function resolveColleges(listing: any): CollegeFact[] {
  const out: CollegeFact[] = [];
  const seen = new Set<string>();

  const push = (name: string | null | undefined, distance: string | null) => {
    const clean = String(name ?? "").trim();
    if (!clean) return;
    const slug = buildCollegeSlug({ shortName: clean, name: clean });
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push({ name: clean, shortName: clean, slug, distanceText: distance });
  };

  const navigation = listing?.navigation;
  if (navigation?.referenceName) {
    const raw = String(navigation.distanceFromReference ?? "").trim();
    // "400" is metres typed without a unit; "400 m" and "5 min walk" already
    // read correctly. Adding " m" to a bare number is a formatting choice, not
    // a claim — the number itself is exactly what the admin entered.
    const distance = raw ? (/^\d+$/.test(raw) ? `${raw} m` : raw) : null;
    push(navigation.referenceName, distance);
  }

  for (const place of listing?.places ?? []) {
    if (String(place?.category ?? "").toUpperCase() !== "COLLEGE") continue;
    push(place?.name, place?.distance ? String(place.distance) : null);
  }

  return out;
}

/** The live listing payload, narrowed to what a page is allowed to say. */
export function toHostelFacts(
  listing: any,
  extra: {
    updatedAt?: Date | string | null;
    reviews?: { count: number; average: number | null; items: ReviewFact[] };
  } = {},
): HostelFacts {
  const hostel = listing?.hostel ?? {};

  return {
    id: String(hostel.id ?? ""),
    slug: String(hostel.public_slug ?? ""),
    name: String(hostel.name ?? ""),

    // Phase 1 has no `areas` table, so the locality is not yet known and the
    // city carries the page. Phase 3 fills this in without touching the page.
    areaName: null,
    areaSlug: null,
    city: hostel.city ?? null,
    state: hostel.state ?? null,
    address: hostel.address ?? null,

    hostelType: hostel.hostel_type ?? null,
    foodIncluded: Boolean(hostel.food_included),
    verified: true, // DISCOVERABLE requires verification_status VERIFIED.

    startingPrice: resolveStartingPrice(listing),
    sharing: resolveSharing(listing),
    bedTiers: (listing?.bed_tiers ?? []).map((tier: any) => ({
      name: tier?.name ?? null,
      sharing: Number(tier?.sharing ?? 0),
      price: Number.isFinite(Number(tier?.price)) && Number(tier?.price) > 0 ? Number(tier.price) : null,
      availability: tier?.availability ?? null,
      space: tier?.space?.summary ?? null,
    })),

    tagline: hostel.tagline ?? null,
    about: hostel.about ?? null,
    highlights: Array.isArray(hostel.highlights) ? hostel.highlights : [],
    amenities: (listing?.amenities ?? [])
      .map((amenity: any) => String(amenity?.label ?? "").trim())
      .filter(Boolean),

    photos: Array.isArray(hostel.photos) ? hostel.photos : [],

    vacantBeds: (listing?.rooms ?? []).reduce(
      (total: number, room: any) => total + Number(room?.available_beds ?? 0),
      0,
    ),
    availabilityConfirmed: Boolean(listing?.availability_confirmed),
    platformListed: Boolean(listing?.platform_listed),

    colleges: resolveColleges(listing),
    places: (listing?.places ?? []).map((place: any) => ({
      name: String(place?.name ?? ""),
      distance: place?.distance ? String(place.distance) : null,
      category: place?.category ?? null,
    })),

    mess: listing?.mess
      ? {
          type: listing.mess.type ?? null,
          meals: (listing.mess.meals ?? []).map((meal: any) => ({
            key: String(meal?.key ?? ""),
            label: String(meal?.label ?? ""),
            time: meal?.time ?? null,
          })),
          week: Array.isArray(listing.mess.week) ? listing.mess.week : [],
        }
      : null,

    host: listing?.host
      ? {
          name: listing.host.name ?? null,
          hostingSince: listing.host.hosting_since ?? listing.host.listed_since ?? null,
          languages: Array.isArray(listing.host.languages) ? listing.host.languages : [],
          verified: Boolean(listing.host.verified),
          platformListed: Boolean(listing.host.platform_listed),
        }
      : null,

    navigation: listing?.navigation
      ? {
          landmark: listing.navigation.landmark ?? null,
          referenceName: listing.navigation.referenceName ?? null,
          distance: listing.navigation.distanceFromReference ?? null,
        }
      : null,

    /**
     * THIS HOSTEL's reviews, from `reviewsService.listPublished` — composed,
     * not recounted.
     *
     * Deliberately NOT `listing.host.stats`, which is what this first read and
     * which was wrong: `loadHostStats` aggregates **across every hostel the
     * owner runs** (its own comment says so). For a multi-hostel owner that
     * would have put reviews written about one hostel into another hostel's
     * `aggregateRating` — a rating no reader of that page could verify, on the
     * one property Google requires be visible on the page it markets.
     */
    reviewCount: extra.reviews?.count ?? 0,
    rating: extra.reviews?.average ?? null,
    reviews: extra.reviews?.items ?? [],

    updatedAt: extra.updatedAt ?? null,
  };
}

async function loadHostelFacts(slug: string): Promise<HostelFacts | null> {
  try {
    const [listing, row, reviews] = await Promise.all([
      discoveryService.getListing(slug),
      // `lastmod` must be a real timestamp. Read beside the listing rather than
      // widening `getListing`'s payload for one consumer.
      prisma.hostels.findFirst({
        where: { ...DISCOVERABLE, public_slug: slug },
        select: { updated_at: true },
      }),
      /**
       * Hostel-scoped published reviews, read tolerantly. A failure here must
       * render a page with no reviews section, never a 500 — the listing is
       * the point and the reviews are an addition to it. Same posture
       * `getListing` already takes for the host card and navigation.
       */
      reviewsService.listPublished(slug).catch(() => null),
    ]);

    return toHostelFacts(listing, {
      updatedAt: row?.updated_at ?? null,
      reviews: reviews
        ? {
            count: Number(reviews.summary?.count ?? 0),
            // `average` is null below MIN_REVIEWS_FOR_AVERAGE — the page and
            // the structured data both respect that rather than computing
            // their own mean.
            average: reviews.summary?.average ?? null,
            items: (reviews.reviews ?? []).slice(0, 10).map((review: any) => ({
              rating: Number(review.rating),
              body: review.body ?? null,
              author: String(review.author ?? "A resident"),
              stayDuration: review.stay_duration ?? null,
              stayedHere: Boolean(review.stayed_here),
              createdAt: review.created_at ? String(review.created_at) : null,
            })),
          }
        : undefined,
    });
  } catch {
    // `getListing` throws ApiError.notFound for anything not DISCOVERABLE.
    // A page turns that into a 404; it is not an error worth logging.
    return null;
  }
}

/**
 * The hostel page's data, cached and tagged.
 *
 * Returns null for a hostel that is not discoverable — including one whose
 * listing an admin has suspended. The caller renders a 404.
 */
export async function loadHostelPage(
  slug: string,
): Promise<{ facts: HostelFacts; spec: SeoPageSpec } | null> {
  const facts = await unstable_cache(
    () => loadHostelFacts(slug),
    ["seo", "hostel", slug],
    { tags: [seoTags.hostel(slug)], revalidate: PAGE_REVALIDATE_SECONDS },
  )();

  if (!facts) return null;

  return {
    facts,
    spec: hostelPageSpec({
      facts,
      // Phase 1 has no curated areas or colleges, so no collection page exists
      // to link to yet. Passing nothing is what keeps the internal graph free
      // of links to gated pages.
      areaIsPublished: false,
      publishedCollegeSlugs: [],
    }),
  };
}

/** How many hostels the sitemap has to cover. Decides the shard count. */
export async function countDiscoverableHostels(): Promise<number> {
  return unstable_cache(
    () => prisma.hostels.count({ where: DISCOVERABLE }),
    ["seo", "hostel-count"],
    { tags: [seoTags.sitemap()], revalidate: PAGE_REVALIDATE_SECONDS },
  )();
}

export interface SitemapHostelRow {
  slug: string;
  updatedAt: Date | null;
}

/**
 * One shard's worth of hostels.
 *
 * ORDERED BY `created_at ASC, id ASC` — see `sitemap-xml.ts` for why this
 * ordering is load-bearing rather than arbitrary: a new hostel must append to
 * the last shard, not reshuffle every shard and invalidate all of them.
 * `id` is the tiebreak, so the order is total and a shard boundary cannot move
 * because two hostels were created in the same millisecond.
 */
export async function listSitemapHostels(
  offset: number,
  limit: number,
): Promise<SitemapHostelRow[]> {
  return unstable_cache(
    async () => {
      const rows = await prisma.hostels.findMany({
        where: DISCOVERABLE,
        select: { public_slug: true, updated_at: true },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      });

      return rows
        .filter((row: { public_slug: string | null }) => Boolean(row.public_slug))
        .map((row: { public_slug: string | null; updated_at: Date | null }) => ({ slug: row.public_slug as string, updatedAt: row.updated_at ?? null }));
    },
    ["seo", "sitemap-hostels", String(offset), String(limit)],
    { tags: [seoTags.sitemap()], revalidate: PAGE_REVALIDATE_SECONDS },
  )();
}

/** Slugs for `generateStaticParams`. Capped — the rest render on demand. */
export async function listDiscoverableSlugs(cap = 1000): Promise<string[]> {
  const rows = await prisma.hostels.findMany({
    where: DISCOVERABLE,
    select: { public_slug: true },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    take: cap,
  });

  return rows
    .map((row: { public_slug: string | null }) => row.public_slug)
    .filter((slug: string | null): slug is string => Boolean(slug));
}

/** A hostel as the hub lists it. Composed from `discoveryService.search`. */
export interface HubListing {
  slug: string;
  name: string;
  city: string | null;
  hostelType: string | null;
  startingPrice: number | null;
  sharing: number[];
  foodIncluded: boolean;
  photo: string | null;
  vacantBeds: number | null;
}

/**
 * Everything currently listed, for the hub at `/hostels`.
 *
 * Composes `discoveryService.search` rather than querying hostels directly, so
 * the hub cannot show a hostel the marketplace would not. Capped: the hub is a
 * crawl entry point, not a search UI — once there is enough inventory for that
 * to matter, the area and college pages are the right subdivisions and they
 * gate themselves.
 */
export async function loadHubListings(limit = 50): Promise<HubListing[]> {
  return unstable_cache(
    async () => {
      const results = await discoveryService.search({ limit, sort: "recommended" });

      return (results?.results ?? []).map((card: any) => ({
        slug: String(card.slug ?? ""),
        name: String(card.name ?? ""),
        city: card.city ?? null,
        hostelType: card.hostel_type ?? null,
        startingPrice: card.starting_price ?? null,
        sharing: Array.isArray(card.sharing) ? card.sharing : [],
        foodIncluded: Boolean(card.food_included),
        photo: Array.isArray(card.photos) ? card.photos[0] ?? null : null,
        vacantBeds: card.vacant_beds ?? null,
      }));
    },
    ["seo", "hub", String(limit)],
    { tags: [seoTags.sitemap()], revalidate: PAGE_REVALIDATE_SECONDS },
  )();
}
