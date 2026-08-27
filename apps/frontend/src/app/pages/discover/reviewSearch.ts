import type { HostelReview } from '@features/discover/api';

/**
 * Case-insensitive substring match against a review's body only — not the
 * author name. A reviewer's display name is a server-generated string
 * ("Sharan K.") nobody searching reviews has a reason to type; "search
 * reviews" means "find reviews that mention X", not "find a reviewer".
 */
export function searchReviews(reviews: HostelReview[], query: string): HostelReview[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return reviews;
  return reviews.filter((review) => (review.body ?? '').toLowerCase().includes(trimmed));
}
