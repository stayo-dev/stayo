import { Award } from 'lucide-react';

import type { ReviewSummary } from '@features/discover/api';
import { StarRating } from '@shared/ui-patterns/StarRating';

import { C, FONT } from '../discoverTheme';
import { CATEGORY_ICONS } from './reviewCategoryMeta';

/**
 * The trust header, the star-distribution breakdown and the category grid —
 * everything above the review cards themselves. Only ever rendered when
 * `summary.average != null`: it never invents a score, so a caller must gate
 * on that before mounting this.
 */
export function ReviewsScoreSummary({ summary }: { summary: ReviewSummary }) {
  return (
    <div className="mt-4">
      <div className="flex items-start gap-4">
        <span
          className="text-[40px] font-extrabold leading-none tracking-[-0.02em]"
          style={{ fontFamily: FONT.display, color: C.text }}
        >
          {summary.average!.toFixed(1)}
        </span>
        <div className="flex flex-col gap-1.5 pt-1.5">
          <StarRating value={Math.round(summary.average!)} size={17} color={C.clay} emptyColor="#DFD5C9" />
          {summary.isResidentFavourite && (
            <span
              className="flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold"
              style={{ background: C.greenPale, color: C.green }}
            >
              <Award className="h-3 w-3" strokeWidth={2.4} />
              TENANT FAVOURITE
            </span>
          )}
          <p className="max-w-[38ch] text-[11.5px] leading-[1.5]" style={{ color: C.textMuted }}>
            Based on {summary.count} verified {summary.count === 1 ? 'review' : 'reviews'} from
            tenants who actually lived here.
          </p>
        </div>
      </div>

      {/* Airbnb's own layout is one row: an "Overall rating" column (the
          5-to-1 distribution, compact) sits beside each category column
          (label/number/icon) as equal siblings — not a full-width
          distribution block followed by a separate category row. Horizontal
          scroll below `lg:` (this component is mounted on every viewport on
          the dedicated Reviews page, and only at `lg:`+ inline on the
          listing page, so it still needs to hold up on a phone), wraps at
          `lg:` and up, matching the free-scroll chip-row convention already
          used for filter rows elsewhere in Discover. */}
      {(summary.distribution.length > 0 || summary.categories.length > 0) && (
        <div
          className="mt-5 flex flex-nowrap gap-x-8 gap-y-5 overflow-x-auto border-t pt-4 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden"
          style={{ borderColor: C.lineSoft }}
        >
          {summary.distribution.length > 0 && (
            <div className="flex w-[170px] flex-none flex-col gap-1.5">
              <span className="text-[11.5px] font-semibold" style={{ color: C.textBody }}>
                Overall rating
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = summary.distribution.find((d) => d.rating === star)?.count ?? 0;
                  const pct = summary.count > 0 ? (count / summary.count) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-1.5">
                      <span className="w-2.5 flex-none text-right text-[10px] tabular-nums" style={{ color: C.textMuted }}>
                        {star}
                      </span>
                      <span className="h-[4px] flex-1 rounded-full" style={{ background: C.line }}>
                        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: C.clay }} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {summary.categories.map((category) => {
            const Icon = CATEGORY_ICONS[category.key];
            return (
              <div key={category.key} className="flex flex-none flex-col gap-1">
                <span className="text-[11.5px] font-semibold" style={{ color: C.textBody }}>
                  {category.label}
                </span>
                <span
                  className="text-[15px] font-extrabold tabular-nums"
                  style={{ fontFamily: FONT.display, color: C.text }}
                >
                  {category.average.toFixed(1)}
                </span>
                {Icon && <Icon className="h-4 w-4" strokeWidth={1.8} style={{ color: C.textGhost }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
