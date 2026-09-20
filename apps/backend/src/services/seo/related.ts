/**
 * The internal link graph: which hostels a hostel page points at.
 *
 * PURE MODULE — no I/O. Callers hand it candidates; it decides and orders.
 *
 * WHY THIS EXISTS SEPARATELY. "Related hostels" is a ranking decision, not a
 * rendering one, and it is the part of the engine most likely to be quietly
 * reimplemented per page. One module, four strategies, so that when locality
 * and college pages grow their own related sections they inherit the same
 * rules rather than inventing near-identical ones.
 *
 * Every strategy is a fact about the data — same area, same campus, similar
 * price, same room type. None is a judgement ("best", "popular"), because
 * nothing in the schema backs one. See ADR-226.
 */

import type { HostelFacts, ListingCardFact, SeoLink } from "./types";
import { hostelUrl } from "./seo-links";

export type RelationKind = "same-area" | "same-college" | "similar-price" | "similar-sharing";

export interface RelatedGroup {
  kind: RelationKind;
  /** Section heading, e.g. "Other hostels in Yamnampet". */
  heading: string;
  links: SeoLink[];
}

/** How far apart two "from" prices may be and still count as similar. */
export const PRICE_BAND = 0.25;

function withoutSelf(candidates: ListingCardFact[], slug: string): ListingCardFact[] {
  return candidates.filter((candidate) => candidate.slug !== slug);
}

/** Cheapest first — a reader scanning alternatives is scanning on price. */
function byPrice(a: ListingCardFact, b: ListingCardFact): number {
  const left = a.startingPrice ?? Number.POSITIVE_INFINITY;
  const right = b.startingPrice ?? Number.POSITIVE_INFINITY;
  return left - right;
}

export function sameArea(facts: HostelFacts, candidates: ListingCardFact[], limit = 6): ListingCardFact[] {
  if (!facts.areaName) return [];
  return withoutSelf(candidates, facts.slug)
    .filter((candidate) => candidate.areaName === facts.areaName)
    .sort(byPrice)
    .slice(0, limit);
}

export function sameCollege(facts: HostelFacts, candidates: ListingCardFact[], limit = 6): ListingCardFact[] {
  // Candidates for this strategy are already scoped to the campus by the
  // caller's query; ordering is by curated distance when it exists, else price.
  return withoutSelf(candidates, facts.slug)
    .slice()
    .sort((a, b) => {
      const hasDistance = Number(Boolean(b.distanceText)) - Number(Boolean(a.distanceText));
      if (hasDistance !== 0) return hasDistance;
      return byPrice(a, b);
    })
    .slice(0, limit);
}

/**
 * Within ±25% of this hostel's advertised "from" price.
 *
 * A band rather than "the N nearest": a reader comparing on price wants
 * alternatives they could actually afford, and the nearest three to a ₹20,000
 * room might all be ₹19,000 — technically nearest, practically the same page.
 * An unpriced hostel has no band and yields nothing rather than everything.
 */
export function similarPrice(facts: HostelFacts, candidates: ListingCardFact[], limit = 6): ListingCardFact[] {
  const anchor = facts.startingPrice;
  if (anchor == null || anchor <= 0) return [];

  const low = anchor * (1 - PRICE_BAND);
  const high = anchor * (1 + PRICE_BAND);

  return withoutSelf(candidates, facts.slug)
    .filter((candidate) => candidate.startingPrice != null && candidate.startingPrice >= low && candidate.startingPrice <= high)
    .sort((a, b) => Math.abs((a.startingPrice ?? 0) - anchor) - Math.abs((b.startingPrice ?? 0) - anchor))
    .slice(0, limit);
}

/** Shares at least one room capacity — "I want a 4-sharing" is a real filter. */
export function similarSharing(facts: HostelFacts, candidates: ListingCardFact[], limit = 6): ListingCardFact[] {
  const wanted = new Set(facts.sharing);
  if (wanted.size === 0) return [];

  return withoutSelf(candidates, facts.slug)
    .filter((candidate) => candidate.sharing.some((capacity) => wanted.has(capacity)))
    .sort(byPrice)
    .slice(0, limit);
}

/**
 * The full set of related groups for a hostel page, deduplicated across
 * strategies.
 *
 * Order matters: the strongest relation claims a hostel first, so the same
 * name never appears under two headings. "Also in Yamnampet" and "Also near
 * SNIST" listing the same hostel twice is how a page starts looking generated.
 */
export function relatedGroups(input: {
  facts: HostelFacts;
  inArea?: ListingCardFact[];
  nearCollege?: ListingCardFact[];
  all?: ListingCardFact[];
  limit?: number;
}): RelatedGroup[] {
  const { facts, limit = 6 } = input;
  const seen = new Set<string>([facts.slug]);
  const groups: RelatedGroup[] = [];

  const take = (kind: RelationKind, heading: string, picks: ListingCardFact[]) => {
    const fresh = picks.filter((pick) => !seen.has(pick.slug));
    if (fresh.length === 0) return;
    for (const pick of fresh) seen.add(pick.slug);
    groups.push({
      kind,
      heading,
      links: fresh.map((pick) => ({ href: hostelUrl(pick.slug), label: pick.name })),
    });
  };

  const collegeName = facts.colleges[0]?.shortName || facts.colleges[0]?.name;

  take("same-area", `Other hostels in ${facts.areaName ?? facts.city ?? "the area"}`, sameArea(facts, input.inArea ?? [], limit));
  if (collegeName) {
    take("same-college", `Other hostels near ${collegeName}`, sameCollege(facts, input.nearCollege ?? [], limit));
  }
  take("similar-price", "Similar rent", similarPrice(facts, input.all ?? [], limit));
  take("similar-sharing", "Same room types", similarSharing(facts, input.all ?? [], limit));

  return groups;
}
