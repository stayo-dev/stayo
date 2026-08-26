import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import type { HostelReview } from '@features/discover/api';
import { StarRating } from '@shared/ui-patterns/StarRating';

import { C, FONT } from '../discoverTheme';
import { reviewerInitials } from '../reviewIdentity';
import { HIGHLIGHT_LABELS } from './reviewCategoryMeta';

const TRUNCATE_AT = 220;

/**
 * One published review. `expanded` is local to each mounted instance — with
 * one card per `review.id`, React already gives every card its own slot, so
 * expanding one never touches its neighbours.
 *
 * `truncate` (default true) is what lets this same component serve both the
 * listing page's compact carousel and the dedicated Reviews page's full,
 * untruncated list — the only difference between them is whether the body
 * clamps at all, everything else (avatar, badge, stars, date, tags) is
 * identical.
 */
export function ReviewsCard({ review, truncate = true }: { review: HostelReview; truncate?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const tags = review.categories
    .filter((category) => category.rating != null && category.rating >= 4)
    .map((category) => HIGHLIGHT_LABELS[category.key])
    .filter(Boolean);

  const dateLabel = new Date(review.created_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const isLong = truncate && (review.body?.length ?? 0) > TRUNCATE_AT;
  const clamp = truncate && !expanded;

  return (
    <article className="rounded-2xl border bg-white p-4" style={{ borderColor: C.line }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] font-extrabold"
            style={{ fontFamily: FONT.display, background: C.clayPaleBg, color: C.clayDeep }}
          >
            {reviewerInitials(review.author)}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className="truncate text-[13px] font-bold"
              style={{ fontFamily: FONT.display, color: C.text }}
            >
              {review.author}
            </span>
            <span
              className="flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold"
              style={{ background: C.greenPale, color: C.green }}
            >
              <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.4} />
              {review.stay_duration
                ? `VERIFIED · ${review.stay_duration.toUpperCase()}`
                : review.stayed_here
                  ? 'LIVED HERE'
                  : 'RESIDENT'}
            </span>
          </div>
        </div>
        <StarRating value={review.rating} color={C.clay} emptyColor="#DFD5C9" />
      </div>

      <p className="mt-2 text-[11px]" style={{ color: C.textFaint }}>
        {dateLabel}
      </p>

      {review.body && (
        <>
          <p
            className={`mt-2 text-[12.5px] leading-[1.65] ${clamp ? 'line-clamp-4' : ''}`}
            style={{ color: C.textBody }}
          >
            {review.body}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 text-[12px] font-bold underline underline-offset-4"
              style={{ color: C.text }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-[7px] px-2 py-1 text-[10.5px] font-semibold"
              style={{ background: C.chipBg, color: '#6E6459' }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
