/**
 * How much real inventory a generated page needs, and which parts of it
 * switch on as inventory grows.
 *
 * PURE MODULE — no I/O.
 *
 * ## The rule changed, deliberately
 *
 * This gate originally withheld a locality page until three listings, to
 * avoid the one way programmatic SEO reliably fails: a template multiplied
 * across a dimension with nothing behind it, producing near-identical pages
 * with one result each. That reasoning still holds for a page that is only a
 * filtered list.
 *
 * It does not hold for a page that is genuinely *about a place*. Someone
 * searching "Yamnampet hostel" today should land on Stayo even though one
 * verified hostel is listed there — and the page they land on is not a bare
 * result set: it carries the locality's own editorial intro, its position in
 * the Hyderabad → Ghatkesar → Yamnampet chain, the campuses it serves, and
 * the hostel itself. That is a document about Yamnampet, not a doorway.
 *
 * So publication starts at one listing, and the page gets *richer* rather
 * than *existing* as inventory arrives:
 *
 *   1 listing   → the page publishes
 *   2 listings  → a comparison section appears
 *   3+ listings → recommendations appear
 *
 * The doorway risk moves to where it actually belongs: intent pages, which
 * are by construction a subset of their parent and therefore the pages most
 * likely to duplicate one that already exists.
 *
 * ## The invariant that still holds
 *
 * Nothing here is a feature flag and nothing is manual. Onboarding a hostel
 * is what publishes and then enriches these pages — no deploy, no toggle.
 * That is the whole "10 hostels to 10,000 without changing the architecture"
 * claim, and it lives in these four numbers. See ADR-226.
 */

/**
 * One verified listing is enough for a locality page to be worth landing on.
 * The page is about the place; the listing is one of the things on it.
 */
export const MIN_LISTINGS_AREA = 1;

/** Same reasoning. A college page with one nearby hostel still answers the search. */
export const MIN_LISTINGS_COLLEGE = 1;

/** A city aggregates its localities, so it can never need more than one. */
export const MIN_LISTINGS_CITY = 1;

/**
 * Higher, and this is where the doorway risk actually lives. An intent page
 * ("girls hostels in Yamnampet") is BY CONSTRUCTION a subset of its parent
 * locality page. Below three, the filter does not narrow anything a reader
 * could not see on the parent, so the two pages say the same thing twice.
 */
export const MIN_LISTINGS_INTENT = 3;

/** A second listing is the first point at which comparing is possible at all. */
export const MIN_LISTINGS_COMPARISON = 2;

/** Recommending one of two is not a recommendation. */
export const MIN_LISTINGS_RECOMMENDATIONS = 3;

export type CollectionKind = "area" | "city" | "college" | "intent";

export type GateOutcome =
  /** Enough inventory, and published: render it and put it in the sitemap. */
  | { status: "ok" }
  /** A real dimension with nothing behind it yet. 404 — see below. */
  | { status: "thin"; needed: number; have: number }
  /** No such row, or an admin has not published it. 404. */
  | { status: "missing" };

/** Which sections of a collection page are switched on at this inventory. */
export interface CollectionFeatures {
  /** Side-by-side price/sharing/food comparison. */
  comparison: boolean;
  /** "You might also consider" — needs a field to choose from. */
  recommendations: boolean;
}

export function minimumFor(kind: CollectionKind): number {
  switch (kind) {
    case "area":
      return MIN_LISTINGS_AREA;
    case "city":
      return MIN_LISTINGS_CITY;
    case "college":
      return MIN_LISTINGS_COLLEGE;
    case "intent":
      return MIN_LISTINGS_INTENT;
  }
}

/**
 * The one gate. Called by the page route AND by the sitemap shard builder —
 * `tests/seo-thresholds.test.ts` asserts they import this same symbol,
 * because the failure it prevents is specific: a page that 404s while the
 * sitemap still advertises it, which is how a site teaches Google to
 * distrust its own sitemap.
 *
 * Below threshold the answer is `thin`, and callers turn that into a **404,
 * not a `noindex`**. A `noindex` page is still fetched, still costs crawl
 * budget and still has to be rendered; and a thin collection appears in no
 * sitemap and on no internal link, so nothing reaches it anyway.
 */
export function collectionGate(input: {
  kind: CollectionKind;
  exists: boolean;
  isPublished: boolean;
  listingCount: number;
}): GateOutcome {
  if (!input.exists || !input.isPublished) return { status: "missing" };

  const needed = minimumFor(input.kind);
  if (input.listingCount < needed) {
    return { status: "thin", needed, have: input.listingCount };
  }

  return { status: "ok" };
}

/** Convenience for sitemap builders, which only care about the boolean. */
export function passesGate(input: Parameters<typeof collectionGate>[0]): boolean {
  return collectionGate(input).status === "ok";
}

/**
 * What a published collection page shows at this inventory level.
 *
 * Kept beside the gate rather than in the component, so "when does the
 * comparison appear" is a rule with a test rather than a condition buried in
 * JSX — and so the page grows on its own as hostels are onboarded.
 */
export function collectionFeatures(listingCount: number): CollectionFeatures {
  return {
    comparison: listingCount >= MIN_LISTINGS_COMPARISON,
    recommendations: listingCount >= MIN_LISTINGS_RECOMMENDATIONS,
  };
}
