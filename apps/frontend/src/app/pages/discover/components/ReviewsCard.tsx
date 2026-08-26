import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import type { HostelReview } from '@features/discover/api';
import { StarRating } from '@shared/ui-patterns/StarRating';

import { C, FONT } from '../discoverTheme';
import { HIGHLIGHT_LABELS } from './reviewCategoryMeta';

const TRUNCATE_AT = 220;

/**
 * One published review. `expanded` is local to each mounted instance — with
 * one card per `review.id`, React already gives every card its own slot, so
 * expanding one never touches its neighbours.
 */
export function ReviewsCard({ review }: { review: HostelReview }) {
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

  const isLong = (review.body?.length ?? 0) > TRUNCATE_AT;

  return (
    <article className="rounded-2xl border bg-white p-4" style={{ borderColor: C.line }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate text-[13px] font-bold"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            {review.author}
          </span>
          <span
            className="flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold"
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
        <StarRating value={review.rating} color={C.clay} emptyColor="#DFD5C9" />
      </div>

      <p className="mt-1 text-[11px]" style={{ color: C.textFaint }}>
        {dateLabel}
      </p>

      {review.body && (
        <>
          <p
            className={`mt-2 text-[12.5px] leading-[1.65] ${expanded ? '' : 'line-clamp-4'}`}
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
