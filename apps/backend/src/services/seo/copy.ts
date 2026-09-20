/**
 * The words on an indexable page: titles, descriptions, headings, intros.
 *
 * PURE MODULE — no I/O.
 *
 * TWO RULES GOVERN EVERYTHING HERE.
 *
 * 1. **Every string is composed from a column.** This is the same discipline
 *    `shareDescription` states for the unfurl card, applied to the page that
 *    card points at: "the moment it contains something we cannot back, every
 *    other claim on the listing is worth less." No adjective appears unless a
 *    field produced it. There is no "best", no "popular", no "affordable".
 *
 * 2. **No two pages get the same title.** The failure mode of programmatic SEO
 *    is a template stamped across a dimension, producing a thousand pages
 *    Google reads as one. Every title here varies on at least two real
 *    dimensions — a hostel's on locality AND type AND price, a collection's on
 *    subject AND count AND price floor — so two pages can only collide if the
 *    underlying hostels genuinely are the same.
 *
 * See ADR-224.
 */

import type {
  CollectionStats,
  CollectionSubject,
  HostelFacts,
} from "./types";
import type { IntentDefinition } from "./intents";

/** Indian digit grouping — ₹1,20,000, not ₹120,000. Mirrors `share-card.ts`. */
export function formatRupees(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function priceLabel(value: number | null): string | null {
  return value == null ? null : `₹${formatRupees(value)}`;
}

/** "single, 2-bed, 4-bed" — the vocabulary `share-card.ts` already uses. */
export function sharingLabel(sharing: number[]): string | null {
  if (!sharing || sharing.length === 0) return null;
  return sharing
    .slice()
    .sort((a, b) => a - b)
    .map((capacity) => (capacity === 1 ? "single" : `${capacity}-bed`))
    .join(", ");
}

/** How a hostel's audience reads in a sentence. Null when unset — not "any". */
export function audienceLabel(hostelType: string | null): string | null {
  switch (String(hostelType ?? "").toUpperCase()) {
    case "BOYS":
      return "Boys";
    case "GIRLS":
      return "Girls";
    case "CO_LIVING":
      return "Co-living";
    case "WORKING_PROS":
      return "Working professionals";
    default:
      return null;
  }
}

/** Lowercase noun phrase: "boys hostels", falling back to plain "hostels". */
export function audiencePhrase(hostelType: string | null): string {
  switch (String(hostelType ?? "").toUpperCase()) {
    case "BOYS":
      return "boys hostels";
    case "GIRLS":
      return "girls hostels";
    case "CO_LIVING":
      return "co-living spaces";
    case "WORKING_PROS":
      return "hostels for working professionals";
    default:
      return "hostels";
  }
}

/** The locality if one is curated, else the city. Never a guess from address. */
export function placeName(facts: Pick<HostelFacts, "areaName" | "city">): string | null {
  return facts.areaName || facts.city || null;
}

/**
 * The nearest college, when one is linked.
 *
 * "Near SNIST" is the single highest-intent phrase Stayo can put in a title —
 * students search the campus, not the locality. It is only ever a linked
 * `colleges` row, never a string scraped out of an address.
 */
export function nearestCollege(facts: HostelFacts): string | null {
  const first = facts.colleges[0];
  if (!first) return null;
  return first.shortName || first.name;
}

/* ── Hostel page ───────────────────────────────────────────────────────── */

/**
 * Title, under ~60 characters wherever the data allows.
 *
 * Shape: `<Name>, <Locality> — <Audience> Hostel from ₹X | Stayo`
 * Falls back gracefully as fields go missing, and never emits an empty
 * separator or a dangling dash.
 */
export function hostelTitle(facts: HostelFacts): string {
  const place = placeName(facts);
  const audience = audienceLabel(facts.hostelType);
  const price = priceLabel(facts.startingPrice);

  const head = place ? `${facts.name}, ${place}` : facts.name;

  const descriptor = [audience, "Hostel"].filter(Boolean).join(" ");
  const tail = price ? `${descriptor} from ${price}` : descriptor;

  return `${head} — ${tail} | Stayo`;
}

/**
 * Meta description. Facts, in the order a searcher scans them: what it is,
 * where it is, what it costs, what you get.
 *
 * A bed count is deliberately absent even when known: this string is cached
 * and re-crawled on its own schedule, and "3 beds left" going stale is a
 * promise Stayo cannot keep. Availability lives on the page, as a band.
 */
export function hostelDescription(facts: HostelFacts): string {
  const parts: string[] = [];

  const place = placeName(facts);
  const audience = audiencePhrase(facts.hostelType);
  const where = place ? ` in ${place}` : "";
  const city = place && facts.city && facts.city !== place ? `, ${facts.city}` : "";

  parts.push(`${facts.name} is a verified ${audience.replace(/s$/, "")}${where}${city}`.trim());

  const college = nearestCollege(facts);
  const distance = facts.colleges[0]?.distanceText;
  if (college) {
    parts.push(distance ? `${distance} from ${college}` : `near ${college}`);
  }

  parts.push(
    facts.startingPrice == null
      ? "Price on request"
      : `rooms from ₹${formatRupees(facts.startingPrice)}/month`,
  );

  const sharing = sharingLabel(facts.sharing);
  if (sharing) parts.push(`${sharing} sharing`);
  if (facts.foodIncluded) parts.push("meals included");

  return `${parts.join(" · ")}.`;
}

/** The visible H1. Differs from the title on purpose — no "| Stayo" on-page. */
export function hostelHeading(facts: HostelFacts): string {
  const place = placeName(facts);
  return place ? `${facts.name}, ${place}` : facts.name;
}

/**
 * The sentence under the H1.
 *
 * Prefers the owner's own approved tagline — their words beat generated ones.
 * Only composes a line when they have not written one.
 */
export function hostelLede(facts: HostelFacts): string {
  if (facts.tagline) return facts.tagline;

  const audience = audiencePhrase(facts.hostelType).replace(/s$/, "");
  const place = placeName(facts);
  const college = nearestCollege(facts);

  const bits = [`A verified ${audience}`];
  if (place) bits.push(`in ${place}`);
  if (college) {
    const distance = facts.colleges[0]?.distanceText;
    bits.push(distance ? `${distance} from ${college}` : `near ${college}`);
  }

  return `${bits.join(" ")}.`;
}

/**
 * The availability band.
 *
 * A band, not a count. Under ISR this page is correct for up to an hour, and a
 * stale "2 beds left" on a page someone is choosing a home from is exactly the
 * invented-certainty failure ADR-073 exists to prevent. `null` when vacancy
 * cannot be trusted at all (a PLATFORM_LISTED hostel has no real rooms).
 */
export function availabilityBand(
  facts: Pick<HostelFacts, "vacantBeds" | "availabilityConfirmed">,
): { label: string; open: boolean } | null {
  if (!facts.availabilityConfirmed || facts.vacantBeds == null) return null;
  return facts.vacantBeds > 0
    ? { label: "Beds available", open: true }
    : { label: "Currently full", open: false };
}

/* ── Collection pages ──────────────────────────────────────────────────── */

/** "Hostels in Yamnampet" / "Hostels near SNIST" / "Boys Hostels in Yamnampet". */
export function collectionHeading(
  subject: CollectionSubject,
  intent: IntentDefinition | null,
): string {
  const preposition = subject.kind === "college" ? "near" : "in";
  const noun = intent ? intent.label : "Hostels";
  const name = subject.kind === "college" ? subject.shortName || subject.name : subject.name;
  return `${noun} ${preposition} ${name}`;
}

/**
 * Collection title, varying on subject AND inventory so two collections cannot
 * share one: `Hostels in Yamnampet — 7 PGs from ₹6,500 | Stayo`.
 */
export function collectionTitle(
  subject: CollectionSubject,
  stats: CollectionStats,
  intent: IntentDefinition | null,
): string {
  const heading = collectionHeading(subject, intent);
  const price = priceLabel(stats.minPrice);

  const facts = [`${stats.listingCount} verified`];
  if (price) facts.push(`from ${price}`);

  return `${heading} — ${facts.join(" ")} | Stayo`;
}

export function collectionDescription(
  subject: CollectionSubject,
  stats: CollectionStats,
  intent: IntentDefinition | null,
): string {
  const parts: string[] = [];
  const preposition = subject.kind === "college" ? "near" : "in";
  const name = subject.kind === "college" ? subject.shortName || subject.name : subject.name;
  const noun = intent ? intent.phrase : "hostels and PGs";

  parts.push(`Compare ${stats.listingCount} verified ${noun} ${preposition} ${name}`);

  if (stats.minPrice != null) {
    parts.push(
      stats.maxPrice != null && stats.maxPrice !== stats.minPrice
        ? `₹${formatRupees(stats.minPrice)}–₹${formatRupees(stats.maxPrice)}/month`
        : `from ₹${formatRupees(stats.minPrice)}/month`,
    );
  }

  const sharing = sharingLabel(stats.sharing);
  if (sharing) parts.push(`${sharing} sharing`);
  if (stats.withFood > 0) parts.push(`${stats.withFood} with meals included`);

  return `${parts.join(" · ")}. Real prices, real availability on Stayo.`;
}

/**
 * The paragraph under a collection's H1.
 *
 * Prefers the admin's written `intro` — a human sentence about a locality is
 * worth more than a generated one, and it is what makes two locality pages
 * genuinely different documents rather than one template twice. Falls back to
 * a composed summary of the set, which is still built only from counts and
 * prices that exist.
 */
export function collectionLede(
  subject: CollectionSubject,
  stats: CollectionStats,
  intent: IntentDefinition | null,
): string {
  if (subject.intro) return subject.intro;

  const preposition = subject.kind === "college" ? "near" : "in";
  const name = subject.kind === "college" ? subject.shortName || subject.name : subject.name;
  const noun = intent ? intent.phrase : "hostels and PGs";

  const bits = [`Stayo lists ${stats.listingCount} verified ${noun} ${preposition} ${name}`];

  if (stats.minPrice != null && stats.maxPrice != null) {
    bits.push(
      stats.minPrice === stats.maxPrice
        ? `at ₹${formatRupees(stats.minPrice)} a month`
        : `from ₹${formatRupees(stats.minPrice)} to ₹${formatRupees(stats.maxPrice)} a month`,
    );
  }

  const sentence = `${bits.join(" ")}.`;

  const extras: string[] = [];
  if (stats.withVacancy > 0) {
    extras.push(
      stats.withVacancy === stats.listingCount
        ? "Every one of them has beds free right now"
        : `${stats.withVacancy} have beds free right now`,
    );
  }
  if (stats.withFood > 0) extras.push(`${stats.withFood} include meals`);

  return extras.length > 0 ? `${sentence} ${extras.join(", ")}.` : sentence;
}
