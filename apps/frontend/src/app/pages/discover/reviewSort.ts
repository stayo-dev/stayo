import type { HostelReview } from '@features/discover/api';

export type ReviewSortMode = 'relevant' | 'newest' | 'highest' | 'lowest';

export const REVIEW_SORT_OPTIONS: { mode: ReviewSortMode; label: string }[] = [
  { mode: 'relevant', label: 'Most relevant' },
  { mode: 'newest', label: 'Newest' },
  { mode: 'highest', label: 'Highest rated' },
  { mode: 'lowest', label: 'Lowest rated' },
];

/**
 * Sorts a copy — never the input array. `reviews` is `data.reviews` straight
 * from the React Query cache; `Array.prototype.sort` mutates in place, which
 * would silently corrupt that cache entry for every other consumer of
 * `useHostelReviews(slug)` sharing the same query key (e.g. the listing
 * page's carousel).
 *
 * "Most relevant" has no real signal behind it — there is no
 * helpfulness/relevance score anywhere in this data model — so it is the
 * untouched API order (already newest-first from the backend), left
 * distinct from "Newest" in name only so a future backend change to the
 * default order doesn't have to touch this file.
 */
export function sortReviews(reviews: HostelReview[], mode: ReviewSortMode): HostelReview[] {
  const copy = [...reviews];
  switch (mode) {
    case 'newest':
      return copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case 'highest':
      return copy.sort(
        (a, b) => b.rating - a.rating || new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    case 'lowest':
      return copy.sort(
        (a, b) => a.rating - b.rating || new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    case 'relevant':
    default:
      return copy;
  }
}
