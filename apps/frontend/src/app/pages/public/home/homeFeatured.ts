import type { DiscoverCard } from '@features/discover/api';

export type FeaturedLayout = 'none' | 'editorial' | 'grid';

export interface FeaturedPlan {
  layout: FeaturedLayout;
  cards: DiscoverCard[];
  /** The listing whose photograph fronts the hero. */
  lead: DiscoverCard | null;
  showBrowseAll: boolean;
}

/** Up to this many listings are shown large; past it they become a grid. */
export const EDITORIAL_MAX = 3;
/** The grid never shows more than this before deferring to `/discover`. */
export const GRID_MAX = 6;

/**
 * How many listings there are decides how they are shown.
 *
 * Two listings shown large read as curation. The same two in a twelve-slot
 * grid read as failure — the empty slots do the talking. So the count drives
 * the layout rather than the layout being fixed and the content rattling
 * around inside it.
 */
export function planFeatured(cards: DiscoverCard[]): FeaturedPlan {
  if (cards.length === 0) {
    return { layout: 'none', cards: [], lead: null, showBrowseAll: false };
  }
  const lead = cards.find((card) => (card.photos?.length ?? 0) > 0) ?? cards[0];
  if (cards.length <= EDITORIAL_MAX) {
    return { layout: 'editorial', cards, lead, showBrowseAll: false };
  }
  return { layout: 'grid', cards: cards.slice(0, GRID_MAX), lead, showBrowseAll: true };
}

export type HomeSupplyState = 'loading' | 'empty' | 'ready';

/**
 * Loading is not the same as empty, and conflating them is a real bug.
 *
 * On first paint the listings query has no data, so a page that branches on
 * `cards.length === 0` alone renders the zero-supply layout — brand-only hero,
 * no city chip, no listings — and then pops into the real page a moment later.
 * Every first visit would flash the wrong page, and the wrong page happens to
 * be the one that says Stayo has nothing.
 */
export function homeSupplyState(isLoading: boolean, cardCount: number): HomeSupplyState {
  if (isLoading) return 'loading';
  return cardCount === 0 ? 'empty' : 'ready';
}
