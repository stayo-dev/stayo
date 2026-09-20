import { unstable_cache } from "next/cache";

import { prisma } from "@/lib/db";
import { discoveryService, DISCOVERABLE } from "@/src/services/discovery/discovery-service";
import { reviewsService } from "@/src/services/discovery/reviews-service";
import { advertisedStartingPrice } from "@/src/services/discovery/listing-projection";
import { seoTags } from "@/lib/cache/public-listing-cache";
import { buildCollegeSlug, normaliseSlug } from "./slug";
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
 * See ADR-226.
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
    /** Nearest first: [Yamnampet, Ghatkesar, Hyderabad]. */
    areaChain?: { name: string; slug: string; kind: string }[];
    /** Curated campuses, nearest first. Replaces the navigation-derived guess. */
    colleges?: CollegeFact[];
  } = {},
): HostelFacts {
  const hostel = listing?.hostel ?? {};

  return {
    id: String(hostel.id ?? ""),
    slug: String(hostel.public_slug ?? ""),
    name: String(hostel.name ?? ""),

    /**
     * The curated locality chain, nearest first. Empty until an admin assigns
     * an area, at which point the breadcrumb, the postal address and the
     * locality links all deepen on their own — no code change. ADR-226.
     */
    areaName: extra.areaChain?.[0]?.name ?? null,
    areaSlug: extra.areaChain?.[0]?.slug ?? null,
    parentAreaName: extra.areaChain?.[1]?.name ?? null,
    parentAreaSlug: extra.areaChain?.[1]?.slug ?? null,
    cityAreaSlug: extra.areaChain?.find((a) => a.kind === "CITY")?.slug ?? null,
    areaAncestry: extra.areaChain ?? [],
    city: extra.areaChain?.find((a) => a.kind === "CITY")?.name ?? hostel.city ?? null,
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

    /**
     * Curated `hostel_colleges` rows when they exist, falling back to the
     * admin-entered `navigation.referenceName` and the owner's `places[]`.
     * The fallback is what made college names usable before there was a
     * colleges table; it stays so a hostel nobody has linked yet still says
     * which campus it is near.
     */
    colleges: extra.colleges?.length ? extra.colleges : resolveColleges(listing),
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
        select: {
          updated_at: true,
          /**
           * Three levels of ancestry, which covers
           * Yamnampet → Ghatkesar → Hyderabad. Fetched as a nested select
           * rather than a recursive walk: the hierarchy is shallow by design
           * and three round trips per page render is not worth the
           * generality.
           */
          area: {
            select: {
              name: true, slug: true, kind: true, is_published: true,
              parent: {
                select: {
                  name: true, slug: true, kind: true, is_published: true,
                  parent: { select: { name: true, slug: true, kind: true, is_published: true } },
                },
              },
            },
          },
          colleges: {
            orderBy: [{ distance_rank: "asc" }, { created_at: "asc" }],
            select: {
              distance_text: true,
              college: { select: { name: true, short_name: true, slug: true, is_published: true } },
            },
          },
        },
      }),
      /**
       * Hostel-scoped published reviews, read tolerantly. A failure here must
       * render a page with no reviews section, never a 500 — the listing is
       * the point and the reviews are an addition to it. Same posture
       * `getListing` already takes for the host card and navigation.
       */
      reviewsService.listPublished(slug).catch(() => null),
    ]);

    // Nearest first. An unpublished area is still used for the address and
    // the copy — it is a true fact about where the hostel is — but nothing
    // links to its page until an admin publishes it.
    const areaChain: { name: string; slug: string; kind: string; published: boolean }[] = [];
    let node: any = (row as any)?.area;
    while (node && areaChain.length < 4) {
      areaChain.push({ name: node.name, slug: node.slug, kind: node.kind, published: Boolean(node.is_published) });
      node = node.parent;
    }

    const colleges = ((row as any)?.colleges ?? [])
      .filter((link: any) => link.college)
      .map((link: any) => ({
        name: link.college.name,
        shortName: link.college.short_name ?? null,
        slug: link.college.slug,
        distanceText: link.distance_text ?? null,
        published: Boolean(link.college.is_published),
      }));

    return toHostelFacts(listing, {
      updatedAt: row?.updated_at ?? null,
      areaChain,
      colleges,
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
  } catch (error: any) {
    /**
     * ONLY a genuine "not listed" becomes a 404.
     *
     * `getListing` throws `ApiError.notFound` for anything not DISCOVERABLE,
     * and that is a real 404. Everything else — a dropped pooler connection,
     * a query error — must NOT be, and this used to swallow all of them.
     * Telling Google a live hostel is permanently gone because the database
     * blipped for two seconds is how a page falls out of the index for weeks;
     * a 500 is retried, a 404 is believed. Observed during verification: the
     * Supabase pooler returned P1001 mid-session and every page reading
     * through it would have 404'd.
     */
    if (error?.statusCode === 404 || error?.code === "NOT_FOUND") return null;

    console.error("[seo] hostel page load failed:", slug, error?.message ?? error);
    throw error;
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
      /**
       * Only published entities are linked. The gate decides whether a
       * collection page exists; this decides whether anything points at it,
       * and the two must agree or the internal graph gains a link into a 404.
       * Areas carry their own flag through `areaAncestry`, since a locality
       * can be published while its parent is not.
       */
      publishedCollegeSlugs: facts.colleges
        .filter((college) => college.published)
        .map((college) => college.slug),
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
        select: {
          public_slug: true,
          updated_at: true,
          created_at: true,
          /**
           * The approved revision's timestamp, because `hostels.updated_at`
           * alone is NOT when the listing last changed.
           *
           * Two reasons. `hostels.updated_at` carries no `@updatedAt` in
           * `schema.prisma` — it is a plain nullable column that only moves
           * when code explicitly sets it. And the things a reader would call
           * "this listing changed" — new photos, a new price, an edited
           * menu — are written to `hostel_marketing_revisions`, not to the
           * hostel row at all. Reporting only the hostel's timestamp would
           * tell Google a page never changes while its content changes
           * weekly, which is the opposite of the freshness signal this
           * engine exists to produce.
           */
          marketing_revisions: {
            where: { status: "APPROVED" },
            orderBy: { version: "desc" },
            take: 1,
            select: { updated_at: true, reviewed_at: true },
          },
        },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      });

      return rows
        .filter((row: any) => Boolean(row.public_slug))
        .map((row: any) => {
          const revision = row.marketing_revisions?.[0];
          const candidates = [
            row.updated_at,
            revision?.updated_at,
            revision?.reviewed_at,
            // Never null: a listing with no other timestamp still has a
            // creation date, and omitting lastmod entirely is a weaker
            // signal than a real, older one.
            row.created_at,
          ]
            .map((value: Date | string | null | undefined) => (value ? new Date(value) : null))
            .filter((date): date is Date => date !== null && !Number.isNaN(date.getTime()));

          const latest = candidates.length
            ? new Date(Math.max(...candidates.map((date) => date.getTime())))
            : null;

          return { slug: row.public_slug as string, updatedAt: latest };
        });
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

/* ── Collection pages (locality, city, college) ──────────────────────────── */

import { collectionGate, collectionFeatures, type CollectionKind } from "./thresholds";
import { collectionPageSpec, summariseListings } from "./page-spec";
import { resolveIntentSegments, type IntentDefinition } from "./intents";
import { areaUrl, collegeUrl } from "./seo-links";
import type { CollectionSubject, ListingCardFact, SeoLink } from "./types";

export type CollectionStatus = "ok" | "thin" | "missing";

export interface CollectionPageResult {
  status: CollectionStatus;
  subject?: CollectionSubject;
  listings?: ListingCardFact[];
  features?: ReturnType<typeof collectionFeatures>;
  spec?: ReturnType<typeof collectionPageSpec>;
}

/** Maps a discovery search card onto the narrow shape a collection renders. */
function toCard(card: any, distanceText?: string | null): ListingCardFact {
  return {
    slug: String(card.slug ?? ""),
    name: String(card.name ?? ""),
    areaName: card.area_name ?? null,
    city: card.city ?? null,
    hostelType: card.hostel_type ?? null,
    startingPrice: card.starting_price ?? null,
    sharing: Array.isArray(card.sharing) ? card.sharing : [],
    foodIncluded: Boolean(card.food_included),
    photo: Array.isArray(card.photos) ? card.photos[0] ?? null : null,
    vacantBeds: card.vacant_beds ?? null,
    availabilityConfirmed: true,
    distanceText: distanceText ?? null,
  };
}

/** The hostel ids in an area, INCLUDING every descendant area. */
async function hostelIdsForArea(areaId: string): Promise<string[]> {
  // Depth-limited walk rather than a recursive CTE: the hierarchy is
  // city → locality → sub-locality by design, and a bounded walk keeps this
  // expressible in Prisma rather than raw SQL.
  const ids = [areaId];
  let frontier = [areaId];

  for (let depth = 0; depth < 3 && frontier.length > 0; depth += 1) {
    const children: { id: string }[] = await prisma.areas.findMany({
      where: { parent_id: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((child) => child.id);
    ids.push(...frontier);
  }

  const hostels: { id: string }[] = await prisma.hostels.findMany({
    where: { ...DISCOVERABLE, area_id: { in: ids } },
    select: { id: true },
  });

  return hostels.map((hostel) => hostel.id);
}

/**
 * A locality, city or college page.
 *
 * ONE GATE, TWO CALLERS: the page route and the sitemap shard both resolve
 * the status through `collectionGate` here, so the sitemap can never
 * advertise a URL that 404s. `tests/seo-thresholds.test.ts` asserts they
 * import the same symbol.
 *
 * Listings are read through `discoveryService.search` with an explicit id
 * filter rather than fetched-then-filtered. That matters at scale: search
 * caps candidates and filters in memory, so an area page that pulled an
 * arbitrary page of candidates and then narrowed would return a short list
 * silently once inventory grew.
 */
async function loadCollection(
  kind: CollectionKind,
  slug: string,
  intent: IntentDefinition | null,
): Promise<CollectionPageResult> {
  const normalised = normaliseSlug(slug);

  if (kind === "college") {
    const college = await prisma.colleges.findFirst({
      where: { slug: normalised },
      select: {
        id: true, slug: true, name: true, short_name: true, intro: true, is_published: true,
        area: { select: { name: true, slug: true, is_published: true, state: true } },
        hostels: {
          orderBy: [{ distance_rank: "asc" }, { created_at: "asc" }],
          select: { distance_text: true, hostel_id: true },
        },
      },
    });

    if (!college) return { status: "missing" };

    const distanceBy = new Map<string, string | null>(
      college.hostels.map((h: any) => [String(h.hostel_id), h.distance_text ?? null]),
    );
    const results = await discoveryService.search({
      hostelIds: Array.from(distanceBy.keys()),
      limit: 24,
      ...(intent?.filters ?? {}),
    } as any);

    const listings = (results?.results ?? []).map((card: any) =>
      toCard(card, distanceBy.get(card.id) ?? null),
    );

    const gate = collectionGate({
      kind: intent ? "intent" : "college",
      exists: true,
      isPublished: college.is_published,
      listingCount: listings.length,
    });
    if (gate.status !== "ok") return { status: gate.status };

    const subject: CollectionSubject = {
      kind: "college",
      slug: college.slug,
      name: college.name,
      shortName: college.short_name,
      intro: college.intro,
      parentName: college.area?.is_published ? college.area?.name ?? null : null,
      parentSlug: college.area?.is_published ? college.area?.slug ?? null : null,
      state: college.area?.state ?? null,
    };

    return buildCollection(subject, listings, intent);
  }

  const area = await prisma.areas.findFirst({
    where: { slug: normalised },
    select: {
      id: true, slug: true, name: true, kind: true, intro: true, is_published: true, state: true,
      parent: { select: { name: true, slug: true, is_published: true } },
    },
  });

  if (!area) return { status: "missing" };

  const ids = await hostelIdsForArea(area.id);
  const results = ids.length
    ? await discoveryService.search({ hostelIds: ids, limit: 24, ...(intent?.filters ?? {}) } as any)
    : { results: [] };

  const listings = (results?.results ?? []).map((card: any) => toCard(card));

  const gate = collectionGate({
    kind: intent ? "intent" : area.kind === "CITY" ? "city" : "area",
    exists: true,
    isPublished: area.is_published,
    listingCount: listings.length,
  });
  if (gate.status !== "ok") return { status: gate.status };

  const subject: CollectionSubject = {
    kind: area.kind === "CITY" ? "city" : "area",
    slug: area.slug,
    name: area.name,
    intro: area.intro,
    parentName: area.parent?.is_published ? area.parent?.name ?? null : null,
    parentSlug: area.parent?.is_published ? area.parent?.slug ?? null : null,
    state: area.state,
  };

  return buildCollection(subject, listings, intent);
}

async function buildCollection(
  subject: CollectionSubject,
  listings: ListingCardFact[],
  intent: IntentDefinition | null,
): Promise<CollectionPageResult> {
  const stats = summariseListings(listings);
  const [siblings, intents] = await Promise.all([
    loadSiblings(subject),
    loadIntentLinks(subject, listings.length),
  ]);

  return {
    status: "ok",
    subject,
    listings,
    features: collectionFeatures(listings.length),
    spec: collectionPageSpec({ subject, stats, listings, intent, siblings, intents }),
  };
}

/** Across the graph: sibling localities, or the other campuses in this area. */
async function loadSiblings(subject: CollectionSubject): Promise<SeoLink[]> {
  if (subject.kind === "college") {
    if (!subject.parentSlug) return [];
    const peers = await prisma.colleges.findMany({
      where: { is_published: true, area: { slug: subject.parentSlug }, slug: { not: subject.slug } },
      select: { slug: true, name: true, short_name: true },
      take: 8,
    });
    return peers.map((peer: any) => ({
      href: collegeUrl(peer.slug),
      label: `Hostels near ${peer.short_name || peer.name}`,
    }));
  }

  // Children first — a city's localities are the useful subdivision — then
  // true siblings when there are no children to offer.
  const children = await prisma.areas.findMany({
    where: { is_published: true, parent: { slug: subject.slug } },
    select: { slug: true, name: true },
    take: 8,
  });
  if (children.length > 0) {
    return children.map((child: any) => ({
      href: areaUrl(child.slug),
      label: `Hostels in ${child.name}`,
    }));
  }

  if (!subject.parentSlug) return [];
  const peers = await prisma.areas.findMany({
    where: { is_published: true, parent: { slug: subject.parentSlug }, slug: { not: subject.slug } },
    select: { slug: true, name: true },
    take: 8,
  });
  return peers.map((peer: any) => ({ href: areaUrl(peer.slug), label: `Hostels in ${peer.name}` }));
}

/**
 * Filtered views of THIS page that themselves pass the gate.
 *
 * Only offered once the parent has enough inventory for a filter to narrow
 * anything — otherwise every intent link points at a page saying what this
 * one already said.
 */
async function loadIntentLinks(
  subject: CollectionSubject,
  listingCount: number,
): Promise<SeoLink[]> {
  const { ALL_INTENTS } = await import("./intents");
  const { MIN_LISTINGS_INTENT } = await import("./thresholds");
  if (listingCount < MIN_LISTINGS_INTENT) return [];

  const url = subject.kind === "college" ? collegeUrl : areaUrl;
  return ALL_INTENTS.slice(0, 8).map((intent) => ({
    href: url(subject.slug, intent.slug),
    label: `${intent.label} ${subject.kind === "college" ? "near" : "in"} ${subject.shortName || subject.name}`,
  }));
}

export async function loadCollectionPage(
  kind: "area" | "college",
  slug: string,
  intentSegments?: string[],
): Promise<CollectionPageResult> {
  const intent = resolveIntentSegments(intentSegments);

  // An unknown intent segment is not a filtered page, it is a 404 — see
  // `intents.ts` on why the allowlist is closed.
  if (intentSegments && intentSegments.length > 0 && !intent) return { status: "missing" };

  const tag = kind === "college" ? seoTags.college(normaliseSlug(slug)) : seoTags.area(normaliseSlug(slug));

  return unstable_cache(
    () => loadCollection(kind, slug, intent),
    ["seo", "collection", kind, normaliseSlug(slug), intent?.slug ?? "none"],
    { tags: [tag, seoTags.sitemap()], revalidate: PAGE_REVALIDATE_SECONDS },
  )();
}

/** Published collection URLs that pass the gate — for the sitemap. */
export async function listCollectionUrls(): Promise<{ loc: string; lastmod: Date | null }[]> {
  return unstable_cache(
    async () => {
      const [areas, colleges] = await Promise.all([
        prisma.areas.findMany({ where: { is_published: true }, select: { slug: true, updated_at: true } }),
        prisma.colleges.findMany({ where: { is_published: true }, select: { slug: true, updated_at: true } }),
      ]);

      const entries: { loc: string; lastmod: Date | null }[] = [];

      // Resolved through the SAME loader the page uses, so a URL can only
      // enter the sitemap if the page would actually render.
      for (const area of areas) {
        const page = await loadCollection("area", area.slug, null);
        if (page.status === "ok") entries.push({ loc: areaUrl(area.slug), lastmod: area.updated_at ?? null });
      }
      for (const college of colleges) {
        const page = await loadCollection("college", college.slug, null);
        if (page.status === "ok") entries.push({ loc: collegeUrl(college.slug), lastmod: college.updated_at ?? null });
      }

      return entries;
    },
    ["seo", "collection-urls"],
    { tags: [seoTags.sitemap()], revalidate: PAGE_REVALIDATE_SECONDS },
  )();
}
