/**
 * Which hostels the homepage shows, and in what order.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 *
 * Curation is a filter over what is already discoverable, never a bypass of
 * it: the caller passes the cards `discoveryService.search()` returned, so a
 * hostel that has been suspended, unverified or unlisted since it was curated
 * simply falls out of the line-up. Composing the existing predicate rather
 * than re-deriving it is the rule ADR-073 set for exactly this reason.
 */

export interface CuratableCard {
  id: string;
}

export interface CurationResult<T extends CuratableCard> {
  cards: T[];
  /** True when an admin's line-up decided this, rather than the default sort. */
  curated: boolean;
  /**
   * Curated hostels that are no longer discoverable. The homepage ignores
   * these; the admin screen shows them, because a line-up silently one short
   * is worse than one that says why.
   */
  droppedIds: string[];
}

/**
 * Apply a curated order to the discoverable set.
 *
 * With no curation the cards come back untouched, which is the deliberate
 * fallback: an empty line-up must never mean an empty homepage, or forgetting
 * to curate would take the page down.
 */
export function applyCuration<T extends CuratableCard>(cards: T[], orderedIds: string[]): CurationResult<T> {
  if (orderedIds.length === 0) {
    return { cards, curated: false, droppedIds: [] };
  }

  const byId = new Map(cards.map((card) => [card.id, card]));
  const picked: T[] = [];
  const droppedIds: string[] = [];

  for (const id of orderedIds) {
    const card = byId.get(id);
    if (card) picked.push(card);
    else droppedIds.push(id);
  }

  // Every curated hostel has gone missing — treat it as no curation at all
  // rather than showing nothing, for the same reason as the empty case.
  if (picked.length === 0) {
    return { cards, curated: false, droppedIds };
  }

  return { cards: picked, curated: true, droppedIds };
}

/**
 * Normalise a line-up an admin submitted.
 *
 * Deduped, blanks dropped, order preserved as sent, and capped — a homepage
 * line-up is a shortlist, and an admin pasting a hundred ids is a mistake we
 * should not persist.
 */
export const MAX_FEATURED = 12;

export function normaliseLineup(hostelIds: unknown): string[] {
  if (!Array.isArray(hostelIds)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of hostelIds) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length === MAX_FEATURED) break;
  }
  return out;
}
