/**
 * Structured data for Stayo's indexable pages.
 *
 * PURE MODULE — no I/O.
 *
 * ## The rule that shapes this entire file
 *
 * **A property is emitted only when a column produced it.** ADR-073 states it
 * for the listing surface — "no listing data is invented" — and structured
 * data is where breaking that rule is most expensive: schema.org markup that
 * contradicts the visible page, or claims a rating nobody left, is a manual
 * action against the domain, not a cosmetic bug. Google's own guidance is
 * explicit that `aggregateRating` must reflect a rating genuinely collected
 * and visible on the page.
 *
 * So every builder below omits rather than defaults. There is no `?? 0`, no
 * `|| "N/A"`, no placeholder rating. `tests/seo-jsonld.test.ts` pins each
 * omission, because these are the properties a future edit is most likely to
 * "helpfully" fill in.
 *
 * See ADR-226.
 */

import type {
  Breadcrumb,
  CollectionStats,
  CollectionSubject,
  HostelFacts,
  ListingCardFact,
} from "./types";
import { hostelUrl } from "./seo-links";

export type JsonLd = Record<string, unknown>;

/** Drops null/undefined/empty-array keys so no empty property is ever emitted. */
function compact<T extends JsonLd>(node: T): T {
  const out: JsonLd = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    out[key] = value;
  }
  return out as T;
}

/**
 * `<script>` is the one sequence that can break out of a JSON-LD block.
 * Escaping `<` covers `</script>` and `<!--` both, and leaves valid JSON.
 */
export function serialiseJsonLd(nodes: JsonLd[]): string[] {
  return nodes.map((node) => JSON.stringify(node).replace(/</g, "\\u003c"));
}

export function breadcrumbList(crumbs: Breadcrumb[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/**
 * Stayo itself. Emitted on the hub only, not on every page — repeating the
 * publisher on 10,000 pages adds bytes to each one and tells Google nothing it
 * did not learn from the first.
 */
export function organisation(siteUrl: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Stayo",
    url: siteUrl,
    logo: `${siteUrl}/android-chrome-512x512.png`,
  };
}

/**
 * The postal address, with each geographic entity in its own field.
 *
 * WHY THIS IS NOT ONE STRING. The hostel row previously held
 * `"Yamnampet,Ghatkesar"` and that whole string went into `streetAddress`.
 * Those are two places Google already knows, and concatenated they become one
 * string it knows nothing about — the locality signal is lost precisely where
 * it is most valuable. Modelled apart:
 *
 *   streetAddress    Yamnampet    the finest locality, or a real street line
 *   addressLocality  Ghatkesar    its parent area
 *   addressRegion    Telangana
 *   addressCountry   India
 *
 * `addressLocality` is the PARENT rather than the city, because the parent is
 * the entity a searcher types ("boys hostel Ghatkesar"). The city stays
 * reachable through the breadcrumb chain and the area hierarchy.
 */
function postalAddress(facts: HostelFacts): JsonLd | null {
  // The owner's own line wins when it says more than the locality does —
  // "Plot 12, Road No 5" is a street; "Yamnampet" is the locality repeated.
  const ownLine = (facts.address || "").trim();
  const locality = facts.areaName || facts.city || null;
  const isJustTheLocality =
    Boolean(locality) && ownLine.toLowerCase() === String(locality).toLowerCase();

  const streetAddress = ownLine && !isJustTheLocality ? ownLine : locality;

  // Never the same value twice: "Yamnampet, Yamnampet" reads as broken data.
  const parent = facts.parentAreaName || facts.city || null;
  const addressLocality =
    parent && parent.toLowerCase() !== String(streetAddress ?? "").toLowerCase() ? parent : null;

  const address = compact({
    "@type": "PostalAddress",
    streetAddress,
    addressLocality,
    addressRegion: facts.state || null,
    addressCountry: "India",
  });

  // `addressCountry` alone is not an address. If nothing locates the hostel,
  // emit no address node rather than one that says only "India".
  const meaningful = ["streetAddress", "addressLocality", "addressRegion"].some((key) => key in address);
  return meaningful ? address : null;
}

/**
 * One `Offer` per advertised bed tier.
 *
 * `availability` is emitted ONLY when live vacancy is trustworthy. A
 * PLATFORM_LISTED hostel has no rooms inside Stayo, so claiming `InStock`
 * would advertise beds nobody can honour — to someone trying to find somewhere
 * to live. An unpriced tier produces no offer at all: ₹0 is not a free bed.
 */
function offers(facts: HostelFacts): JsonLd[] {
  return facts.bedTiers
    .filter((tier) => tier.price != null && tier.price > 0)
    .map((tier) => {
      const availability = facts.availabilityConfirmed
        ? String(tier.availability ?? "").toUpperCase() === "FULL"
          ? "https://schema.org/SoldOut"
          : "https://schema.org/InStock"
        : null;

      return compact({
        "@type": "Offer",
        name: tier.name || (tier.sharing === 1 ? "Single room" : `${tier.sharing}-sharing`),
        price: tier.price,
        priceCurrency: "INR",
        availability,
        // Monthly rent, not a one-off price — without this a crawler reads
        // ₹8,200 as the cost of the whole stay.
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: tier.price,
          priceCurrency: "INR",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
        },
      });
    });
}

function priceRange(facts: HostelFacts): string | null {
  const prices = facts.bedTiers
    .map((tier) => tier.price)
    .filter((price): price is number => price != null && price > 0);

  if (prices.length === 0) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // Indian digit grouping, matching what the page prints. Structured data that
  // formats a number differently from the visible page is the mismatch that
  // gets markup discounted.
  const format = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return min === max ? format(min) : `${format(min)}–${format(max)}`;
}

/**
 * The hostel itself.
 *
 * `Hostel` rather than the broader `LodgingBusiness`: it is the exact type,
 * and it inherits everything `LodgingBusiness` offers.
 */
export function hostelNode(facts: HostelFacts, pageUrl: string): JsonLd {
  const address = postalAddress(facts);
  const tiers = offers(facts);

  return compact({
    "@context": "https://schema.org",
    "@type": "Hostel",
    "@id": `${pageUrl}#hostel`,
    name: facts.name,
    url: pageUrl,
    description: facts.about || facts.tagline || null,
    image: facts.photos.slice(0, 6),
    address,
    priceRange: priceRange(facts),
    currenciesAccepted: "INR",
    makesOffer: tiers,

    amenityFeature: facts.amenities.map((label) => ({
      "@type": "LocationFeatureSpecification",
      name: label,
      value: true,
    })),

    /**
     * NEVER emitted below one published review.
     *
     * Stayo has zero published reviews today. A rating here would be invented,
     * and it is the single property most likely to be added by mistake later —
     * which is why the test for its absence is the first one in the file.
     */
    ...(facts.reviewCount > 0 && facts.rating != null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: facts.rating,
            reviewCount: facts.reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
          /**
           * The individual reviews, so the aggregate above is backed by
           * markup a reader can see on the page. Google requires a rating in
           * structured data to be visible to users; emitting the aggregate
           * without rendering the reviews is a guideline violation, which is
           * why `HostelFacts` carries `reviews` alongside the count rather
           * than letting them be set independently.
           */
          review: facts.reviews.slice(0, 10).map((entry) =>
            compact({
              "@type": "Review",
              reviewRating: {
                "@type": "Rating",
                ratingValue: entry.rating,
                bestRating: 5,
                worstRating: 1,
              },
              // First name + last initial, per ADR-086 — never a full name.
              author: { "@type": "Person", name: entry.author },
              reviewBody: entry.body || null,
              datePublished: entry.createdAt ? String(entry.createdAt).slice(0, 10) : null,
            }),
          ),
        }
      : {}),

    /**
     * No `geo`: there is no latitude or longitude anywhere in this schema. A
     * coordinate derived from a free-text address would be a guess rendered as
     * a map pin, which is worse than no pin. No `telephone` either — the
     * owner's number is not public on any Stayo surface.
     */
  });
}

/** A collection page's list of hostels, in the order the page renders them. */
export function itemListNode(listings: ListingCardFact[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: listings.length,
    itemListElement: listings.map((listing, index) =>
      compact({
        "@type": "ListItem",
        position: index + 1,
        url: hostelUrl(listing.slug),
        name: listing.name,
        image: listing.photo || null,
      }),
    ),
  };
}

/**
 * The collection page itself.
 *
 * A college page adds `about: CollegeOrUniversity` — a real curated row, which
 * is what makes "hostels near SNIST" a page about SNIST rather than a filtered
 * list. `hostel_colleges.distance_text` is free text ("400 m", "5 min walk")
 * and is rendered on the page but never lifted into a structured numeric
 * property: ADR-088 keeps it free text precisely because it is a precision
 * nobody measured.
 */
export function collectionNode(input: {
  subject: CollectionSubject;
  stats: CollectionStats;
  listings: ListingCardFact[];
  pageUrl: string;
  name: string;
  description: string;
}): JsonLd {
  const { subject } = input;

  const about =
    subject.kind === "college"
      ? compact({
          "@type": "CollegeOrUniversity",
          name: subject.name,
          alternateName: subject.shortName || null,
        })
      : compact({
          "@type": "Place",
          name: subject.name,
          address: compact({
            "@type": "PostalAddress",
            addressLocality: subject.name,
            // The parent area, so a locality page names its city the same way
            // a hostel page does.
            addressRegion: subject.state || null,
            // "India", matching the hostel node — a site that spells its own
            // country two ways in one crawl is describing two places.
            addressCountry: "India",
          }),
        });

  return compact({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${input.pageUrl}#collection`,
    name: input.name,
    description: input.description,
    url: input.pageUrl,
    about,
    mainEntity: itemListNode(input.listings),
  });
}
