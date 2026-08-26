export const REVIEW_PREVIEW_COUNT = 4;

/** First N reviews for the collapsed grid, or all of them once expanded. */
export function getReviewPreview<T>(
  reviews: T[],
  showAll: boolean,
  previewCount: number = REVIEW_PREVIEW_COUNT,
): T[] {
  return showAll ? reviews : reviews.slice(0, previewCount);
}
