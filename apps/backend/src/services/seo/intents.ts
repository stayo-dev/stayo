/**
 * The closed set of search intents a collection page may be filtered by.
 *
 * PURE MODULE — no I/O.
 *
 * WHY AN ALLOWLIST AND NOT A PARSER. `/hostels-in/:area/:intent` with a
 * permissive parser is infinite crawl space: every typo, every capitalisation
 * and every invented segment is a 200 that Google will fetch, and a crawler
 * finding an unbounded URL space on a small site spends its budget there
 * instead of on the hostel pages. Anything not in this table 404s.
 *
 * Each intent also has to be a question a student actually types. "Boys hostel
 * in Ghatkesar", "hostels under 8000", "4 sharing hostel" — these are the
 * long-tail searches the engine exists to answer. An intent that reads like a
 * database filter rather than a search is not worth a URL.
 *
 * Every intent maps onto filters `discoveryService.search` already supports.
 * No new data model, and nothing here can express a filter the listing data
 * cannot back. See ADR-224.
 */

import type { DiscoverSearchParams } from "@/src/services/discovery/discovery-service";

export interface IntentDefinition {
  /** The URL segment. Permanent once shipped. */
  slug: string;
  /** How the intent reads inside a title: "Boys hostels in Yamnampet". */
  label: string;
  /** How it reads as a noun phrase in body copy: "boys hostels". */
  phrase: string;
  /** The filters it applies, merged over the collection's own dimension. */
  filters: Partial<DiscoverSearchParams>;
}

const DEFINITIONS: IntentDefinition[] = [
  {
    slug: "boys",
    label: "Boys hostels",
    phrase: "boys hostels",
    filters: { hostelType: "BOYS" },
  },
  {
    slug: "girls",
    label: "Girls hostels",
    phrase: "girls hostels",
    filters: { hostelType: "GIRLS" },
  },
  {
    slug: "co-living",
    label: "Co-living spaces",
    phrase: "co-living spaces",
    filters: { hostelType: "CO_LIVING" },
  },
  {
    slug: "working-professionals",
    label: "Hostels for working professionals",
    phrase: "hostels for working professionals",
    filters: { hostelType: "WORKING_PROS" },
  },
  {
    slug: "with-food",
    label: "Hostels with food",
    phrase: "hostels with meals included",
    filters: { foodIncluded: true },
  },
  {
    slug: "single-room",
    label: "Single-room hostels",
    phrase: "single rooms",
    filters: { sharing: [1] },
  },
  {
    slug: "2-sharing",
    label: "2-sharing hostels",
    phrase: "2-sharing rooms",
    filters: { sharing: [2] },
  },
  {
    slug: "3-sharing",
    label: "3-sharing hostels",
    phrase: "3-sharing rooms",
    filters: { sharing: [3] },
  },
  {
    slug: "4-sharing",
    label: "4-sharing hostels",
    phrase: "4-sharing rooms",
    filters: { sharing: [4] },
  },
  {
    slug: "under-6000",
    label: "Hostels under ₹6,000",
    phrase: "hostels under ₹6,000 a month",
    filters: { maxPrice: 6000 },
  },
  {
    slug: "under-8000",
    label: "Hostels under ₹8,000",
    phrase: "hostels under ₹8,000 a month",
    filters: { maxPrice: 8000 },
  },
  {
    slug: "under-10000",
    label: "Hostels under ₹10,000",
    phrase: "hostels under ₹10,000 a month",
    filters: { maxPrice: 10000 },
  },
  {
    slug: "under-12000",
    label: "Hostels under ₹12,000",
    phrase: "hostels under ₹12,000 a month",
    filters: { maxPrice: 12000 },
  },
  {
    slug: "with-vacancy",
    label: "Hostels with beds available",
    phrase: "hostels with beds available now",
    filters: { hasVacancy: true },
  },
];

const BY_SLUG = new Map(DEFINITIONS.map((intent) => [intent.slug, intent]));

export const ALL_INTENTS: readonly IntentDefinition[] = DEFINITIONS;

export const INTENT_SLUGS: readonly string[] = DEFINITIONS.map((intent) => intent.slug);

/** `null` for anything not on the list — callers turn that into a 404. */
export function resolveIntent(slug: string | null | undefined): IntentDefinition | null {
  if (!slug) return null;
  return BY_SLUG.get(String(slug).trim().toLowerCase()) ?? null;
}

export function isKnownIntent(slug: string | null | undefined): boolean {
  return resolveIntent(slug) !== null;
}

/**
 * A catch for a route that passed more than one segment — `[[...intent]]`
 * accepts an array, and `/hostels-in/yamnampet/boys/under-8000` must not
 * quietly render as `boys`. One intent per page or none.
 */
export function resolveIntentSegments(segments: string[] | undefined): IntentDefinition | null {
  if (!segments || segments.length === 0) return null;
  if (segments.length > 1) return null;
  return resolveIntent(segments[0]);
}
