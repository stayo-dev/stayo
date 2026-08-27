import type { HostelReview } from '@features/discover/api';

import { ReviewsCard } from './ReviewsCard';

/**
 * A horizontal, peeking-card preview of a few reviews for the listing page.
 *
 * Each card is a fixed width narrower than its container at every
 * breakpoint (never `w-full`) so the next card always shows a sliver at the
 * right edge — that sliver is what makes "this scrolls" obvious without a
 * hint label. No scroll-snap index tracking or dot indicators: unlike the
 * full-bleed photo gallery elsewhere on this page, a peeking multi-card row
 * doesn't need to announce "which one" is current, only that there's more.
 */
export function ReviewsCarousel({ reviews }: { reviews: HostelReview[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {reviews.map((review) => (
        <div key={review.id} className="w-[85%] max-w-[300px] flex-none snap-start sm:w-[320px]">
          <ReviewsCard review={review} truncate />
        </div>
      ))}
    </div>
  );
}
