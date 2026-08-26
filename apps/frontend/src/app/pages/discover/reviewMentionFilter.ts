import type { HostelReview } from '@features/discover/api';

import { HIGHLIGHT_LABELS } from './components/reviewCategoryMeta';

export interface MentionChip {
  key: string;
  label: string;
  count: number;
}

/** label → key, built once from the same table the backend used to produce the label. */
const LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(HIGHLIGHT_LABELS).map(([key, label]) => [label, key]),
);

/**
 * `summary.highlights` only carries `{label, count}` — the backend flattens
 * away the category key once it picks a friendly label. Filtering by a
 * clicked chip needs the key back, so this resolves it via the same lookup
 * table `reviewCategoryMeta.ts` already exports. An entry whose label
 * doesn't resolve is dropped defensively rather than shown as a dead filter
 * — it shouldn't happen, since the backend's `deriveHighlights` uses this
 * exact table to produce the label in the first place.
 */
export function buildMentionChips(highlights: { label: string; count: number }[]): MentionChip[] {
  return highlights
    .map((highlight) => {
      const key = LABEL_TO_KEY[highlight.label];
      return key ? { key, label: highlight.label, count: highlight.count } : null;
    })
    .filter((chip): chip is MentionChip => chip != null);
}

/** Same >=4 threshold the backend used to decide this review earned the mention in the first place. */
export function reviewMatchesMention(review: HostelReview, key: string): boolean {
  return review.categories.some((category) => category.key === key && category.rating != null && category.rating >= 4);
}

export function filterReviewsByMention(reviews: HostelReview[], key: string | null): HostelReview[] {
  if (!key) return reviews;
  return reviews.filter((review) => reviewMatchesMention(review, key));
}
