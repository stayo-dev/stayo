/**
 * The generator.
 *
 * PURE MODULE — no I/O.
 *
 * One function per page kind, one output type, and every decision about what a
 * page says — its title, its canonical, its structured data, its outbound
 * links — made here from facts rather than in a React component. Two reasons
 * this boundary is where it is:
 *
 * 1. The main test suite cannot reach a database (no test project), so
 *    anything encoding a rule has to be callable with plain objects. Every SEO
 *    decision is therefore verifiable by `npm run test:pure`.
 *
 * 2. The rendering shell stays swappable. These pages are React Server
 *    Components today; the `/h/:slug` share card proves a plain route handler
 *    emitting a string also works. Nothing in this file knows which.
 *
 * Four page kinds — hostel, area, city, college (intent being a filtered area
 * or college) — share `SeoPageSpec`, and differ only in the facts they are
 * handed. That is what "reusable generators over hardcoded pages" means here:
 * adding a fifth kind is a new `*PageSpec` function, not a new template.
 *
 * See ADR-224.
 */

import type {
  Breadcrumb,
  CollectionStats,
  CollectionSubject,
  HostelFacts,
  ListingCardFact,
  SeoLink,
} from "./types";
import type { IntentDefinition } from "./intents";
import {
  areaUrl,
  collegeUrl,
  hostelUrl,
  hubUrl,
  appListingUrl,
  siteUrl,
} from "./seo-links";
import {
  collectionDescription,
  collectionHeading,
  collectionLede,
  collectionTitle,
  hostelDescription,
  hostelHeading,
  hostelLede,
  hostelTitle,
  placeName,
} from "./copy";
import { breadcrumbList, collectionNode, hostelNode, type JsonLd } from "./jsonld";

export type SeoPageKind = "hostel" | "area" | "city" | "college";

export interface SeoPageSpec {
  kind: SeoPageKind;
  /** `<title>`. */
  title: string;
  /** `<meta name="description">`. */
  description: string;
  /** Absolute, self-referencing. Never relative, never another page's. */
  canonicalUrl: string;
  /** The single visible `<h1>`. Differs from `title` deliberately. */
  h1: string;
  /** The sentence under the H1. */
  lede: string;
  robots: { index: boolean; follow: boolean };
  /** OG/Twitter image, already ImageKit-cropped. Null → the site default. */
  image: string | null;
  jsonLd: JsonLd[];
  breadcrumbs: Breadcrumb[];
  /** The internal link graph this page contributes. */
  links: {
    /** Up the hierarchy — area, city. */
    parents: SeoLink[];
    /** Across — sibling localities, other colleges, other hostels. */
    siblings: SeoLink[];
    /** Down/across into filtered views of this same page. */
    intents: SeoLink[];
    /** Into the app: enquiry, live availability. Always `noindex` targets. */
    app: SeoLink[];
  };
}

/* ── Hostel ────────────────────────────────────────────────────────────── */

export interface HostelPageInput {
  facts: HostelFacts;
  /** Other hostels in the same area, already gated and capped by the caller. */
  nearbyInArea?: ListingCardFact[];
  /** Other hostels near the same college. */
  nearbyAtCollege?: ListingCardFact[];
  /** Whether the area page currently passes its threshold — link only if so. */
  areaIsPublished?: boolean;
  /**
   * The college slugs whose pages currently pass the gate.
   *
   * A hostel always NAMES its nearest college in its copy — "400 m from SNIST"
   * is a fact about the hostel and true regardless. But it only LINKS to
   * `/hostels-near/snist` once that page exists. Linking to a gated collection
   * would put a 404 in the internal graph, which is the same defect as a
   * sitemap advertising a page that is not there.
   */
  publishedCollegeSlugs?: string[];
}

export function hostelPageSpec(input: HostelPageInput): SeoPageSpec {
  const { facts } = input;
  const canonicalUrl = hostelUrl(facts.slug);
  const place = placeName(facts);

  const breadcrumbs: Breadcrumb[] = [{ name: "Stayo", url: siteUrl() }];
  if (facts.city) {
    // A city page only exists once curated; until then the crumb still needs
    // a destination, and the hub is the honest one.
    breadcrumbs.push({ name: facts.city, url: hubUrl() });
  }
  if (facts.areaName && facts.areaSlug && input.areaIsPublished) {
    breadcrumbs.push({ name: facts.areaName, url: areaUrl(facts.areaSlug) });
  }
  breadcrumbs.push({ name: facts.name, url: canonicalUrl });

  const parents: SeoLink[] = [];
  if (facts.areaName && facts.areaSlug && input.areaIsPublished) {
    parents.push({ href: areaUrl(facts.areaSlug), label: `Hostels in ${facts.areaName}` });
  }
  const publishedColleges = new Set(input.publishedCollegeSlugs ?? []);
  for (const college of facts.colleges) {
    if (!publishedColleges.has(college.slug)) continue;
    parents.push({
      href: collegeUrl(college.slug),
      label: `Hostels near ${college.shortName || college.name}`,
    });
  }

  const siblings: SeoLink[] = [
    ...(input.nearbyInArea ?? []).map((card) => ({
      href: hostelUrl(card.slug),
      label: card.name,
    })),
    ...(input.nearbyAtCollege ?? [])
      // A hostel already listed as an area sibling must not appear twice.
      .filter((card) => !(input.nearbyInArea ?? []).some((other) => other.slug === card.slug))
      .map((card) => ({ href: hostelUrl(card.slug), label: card.name })),
  ].filter((link) => link.href !== canonicalUrl);

  return {
    kind: "hostel",
    title: hostelTitle(facts),
    description: hostelDescription(facts),
    canonicalUrl,
    h1: hostelHeading(facts),
    lede: hostelLede(facts),
    robots: { index: true, follow: true },
    image: facts.photos[0] ?? null,
    jsonLd: [hostelNode(facts, canonicalUrl), breadcrumbList(breadcrumbs)],
    breadcrumbs,
    links: {
      parents,
      siblings,
      intents: [],
      app: [
        {
          href: appListingUrl(facts.slug),
          label: place ? `See live availability at ${facts.name}` : "See live availability",
        },
      ],
    },
  };
}

/* ── Collections (area, city, college — with or without an intent) ─────── */

export interface CollectionPageInput {
  subject: CollectionSubject;
  stats: CollectionStats;
  listings: ListingCardFact[];
  intent: IntentDefinition | null;
  /** Sibling localities / other colleges that themselves pass the gate. */
  siblings?: SeoLink[];
  /** Intent variants of THIS subject that pass the gate. */
  intents?: SeoLink[];
}

function subjectUrl(subject: CollectionSubject, intent?: string | null): string {
  return subject.kind === "college"
    ? collegeUrl(subject.slug, intent)
    : areaUrl(subject.slug, intent);
}

export function collectionPageSpec(input: CollectionPageInput): SeoPageSpec {
  const { subject, stats, intent } = input;
  const canonicalUrl = subjectUrl(subject, intent?.slug ?? null);
  const heading = collectionHeading(subject, intent);

  const breadcrumbs: Breadcrumb[] = [{ name: "Stayo", url: siteUrl() }];
  if (subject.parentName && subject.parentSlug) {
    breadcrumbs.push({ name: subject.parentName, url: areaUrl(subject.parentSlug) });
  }
  // An intent page's parent is the unfiltered collection — that is the link
  // that consolidates the filtered views back onto the page worth ranking.
  if (intent) {
    breadcrumbs.push({
      name: collectionHeading(subject, null),
      url: subjectUrl(subject, null),
    });
  }
  breadcrumbs.push({ name: heading, url: canonicalUrl });

  const parents: SeoLink[] = [];
  if (intent) {
    parents.push({ href: subjectUrl(subject, null), label: collectionHeading(subject, null) });
  }
  if (subject.parentName && subject.parentSlug) {
    parents.push({
      href: areaUrl(subject.parentSlug),
      label: `Hostels in ${subject.parentName}`,
    });
  }

  const name = heading;
  const description = collectionDescription(subject, stats, intent);

  return {
    kind: subject.kind === "college" ? "college" : subject.kind === "city" ? "city" : "area",
    title: collectionTitle(subject, stats, intent),
    description,
    canonicalUrl,
    h1: heading,
    lede: collectionLede(subject, stats, intent),
    robots: { index: true, follow: true },
    image: input.listings.find((listing) => listing.photo)?.photo ?? null,
    jsonLd: [
      collectionNode({
        subject,
        stats,
        listings: input.listings,
        pageUrl: canonicalUrl,
        name,
        description,
      }),
      breadcrumbList(breadcrumbs),
    ],
    breadcrumbs,
    links: {
      parents,
      siblings: input.siblings ?? [],
      intents: input.intents ?? [],
      app: [{ href: appListingUrl("").replace(/\/$/, ""), label: "Search all hostels" }],
    },
  };
}

/**
 * Aggregates for a collection, computed from the cards the page will show.
 *
 * Derived from the same array the page renders, deliberately: a "from ₹6,500"
 * headline above a list whose cheapest card is ₹7,000 is the exact
 * contradiction that makes a page look generated. One array, one set of
 * numbers.
 */
export function summariseListings(listings: ListingCardFact[]): CollectionStats {
  const prices = listings
    .map((listing) => listing.startingPrice)
    .filter((price): price is number => price != null && price > 0);

  const sharing = new Set<number>();
  const types = new Set<string>();
  let withFood = 0;
  let withVacancy = 0;

  for (const listing of listings) {
    for (const capacity of listing.sharing ?? []) sharing.add(Number(capacity));
    if (listing.hostelType) types.add(listing.hostelType);
    if (listing.foodIncluded) withFood += 1;
    // Only count vacancy that is real — a PLATFORM_LISTED hostel has no rooms.
    if (listing.availabilityConfirmed && (listing.vacantBeds ?? 0) > 0) withVacancy += 1;
  }

  return {
    listingCount: listings.length,
    minPrice: prices.length > 0 ? Math.min(...prices) : null,
    maxPrice: prices.length > 0 ? Math.max(...prices) : null,
    sharing: Array.from(sharing).sort((a, b) => a - b),
    withFood,
    withVacancy,
    types: Array.from(types).sort(),
  };
}
