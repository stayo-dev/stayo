/**
 * The content gate: how much real inventory a generated page needs before it
 * is allowed to exist.
 *
 * PURE MODULE — no I/O.
 *
 * WHY THIS IS THE CENTRE OF THE ENGINE. Programmatic SEO fails in exactly one
 * way: a template multiplied across a dimension that has no content behind it,
 * producing thousands of near-identical pages with one or two results each.
 * Google calls that a doorway network and it costs the whole domain, not just
 * those pages.
 *
 * Stayo has ONE discoverable hostel today. Every locality page, college page
 * and intent page it could generate right now would be a single-result page.
 * So the generators are all built, and this gate is what decides which of them
 * render — and the same gate decides which enter the sitemap, because a URL
 * that is crawlable but absent from the sitemap is still a URL Google finds.
 *
 * THE INVARIANT THAT MAKES THIS SCALE: nothing here is a feature flag and
 * nothing here is manual. Onboarding the third hostel in Yamnampet is what
 * publishes `/hostels-in/yamnampet` — no deploy, no toggle, no ticket. That is
 * the whole "10 hostels to 10,000 without changing the architecture" claim,
 * and it lives in these four numbers. See ADR-226.
 */

/**
 * A locality page needs three listings to say something a hostel page does not.
 * At one, the "page" is a link to that hostel; at two, it is a list nobody
 * needs. Three is where a price range, a sharing mix and a comparison start
 * being real information.
 */
export const MIN_LISTINGS_AREA = 3;

/** Same reasoning as an area. A college with two nearby hostels is a stub. */
export const MIN_LISTINGS_COLLEGE = 3;

/**
 * Higher, deliberately. An intent page ("girls hostels in Yamnampet") is BY
 * CONSTRUCTION a subset of its parent area page, so it is the page most likely
 * to duplicate one that already exists. A 3-listing area crossed with 10
 * intents would emit 10 pages built from the same 3 rows — the doorway pattern
 * in miniature. Five means an intent page only appears once its parent has
 * enough inventory that the filtered view is genuinely a different answer.
 */
export const MIN_LISTINGS_INTENT = 5;

/** A city page aggregates its localities, so it clears earlier. */
export const MIN_LISTINGS_CITY = 2;

export type CollectionKind = "area" | "city" | "college" | "intent";

export type GateOutcome =
  /** Enough inventory, and published: render it and put it in the sitemap. */
  | { status: "ok" }
  /** Real dimension, not enough behind it yet. 404 — see below. */
  | { status: "thin"; needed: number; have: number }
  /** No such row, or an admin has not published it. 404. */
  | { status: "missing" };

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
 * `tests/seo-thresholds.test.ts` asserts they import this same symbol, because
 * the failure this prevents is specific: a page that 404s while the sitemap
 * still advertises it, which is how a site teaches Google to distrust its own
 * sitemap.
 *
 * Below threshold the answer is `thin`, and callers turn that into a **404,
 * not a `noindex`**. A `noindex` page is still fetched, still costs crawl
 * budget and still has to be rendered; and since a thin collection appears in
 * no sitemap and on no internal link, nothing reaches it anyway. Not existing
 * is both cheaper and more honest than existing and asking to be ignored.
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
