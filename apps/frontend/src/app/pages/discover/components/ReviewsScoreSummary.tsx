import { Award } from 'lucide-react';

import type { ReviewSummary } from '@features/discover/api';
import { StarRating } from '@shared/ui-patterns/StarRating';

import { C, FONT } from '../discoverTheme';
import { CATEGORY_ICONS } from './reviewCategoryMeta';

/**
 * The trust header, the star-distribution breakdown, the category grid and
 * the "Residents mention" pills — everything above the review cards
 * themselves. Only ever rendered when `summary.average != null`: it never
 * invents a score, so a caller must gate on that before mounting this.
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
              RESIDENT FAVOURITE
            </span>
          )}
          <p className="max-w-[38ch] text-[11.5px] leading-[1.5]" style={{ color: C.textMuted }}>
            Based on {summary.count} verified {summary.count === 1 ? 'review' : 'reviews'} from
            residents who actually lived here.
          </p>
        </div>
      </div>

      {summary.distribution.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = summary.distribution.find((d) => d.rating === star)?.count ?? 0;
            const pct = summary.count > 0 ? (count / summary.count) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="w-3 flex-none text-right text-[11px] tabular-nums" style={{ color: C.textMuted }}>
                  {star}
                </span>
                <span className="h-[6px] flex-1 rounded-full" style={{ background: C.line }}>
                  <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: C.clay }} />
                </span>
                <span className="w-6 flex-none text-right text-[11px] tabular-nums" style={{ color: C.textMuted }}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {summary.categories.length > 0 && (
        <div className="mt-5 border-t pt-4" style={{ borderColor: C.lineSoft }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: C.textMuted }}>
            Rating breakdown
          </p>
          <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.key];
              return (
                <div key={category.key} className="flex items-center gap-2.5">
                  {Icon && (
                    <span
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
                      style={{ background: C.chipBg }}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} style={{ color: C.clay }} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: C.textBody }}>
                    {category.label}
                  </span>
                  <span
                    className="w-7 flex-none text-right text-[12.5px] font-bold tabular-nums"
                    style={{ fontFamily: FONT.display, color: C.text }}
                  >
                    {category.average.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {summary.highlights.length > 0 && (
        <div className="mt-5 border-t pt-4" style={{ borderColor: C.lineSoft }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: C.textMuted }}>
            Residents mention
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.highlights.slice(0, 6).map((highlight) => (
              <span
                key={highlight.label}
                className="rounded-[10px] px-3 py-1.5 text-[11.5px] font-semibold"
                style={{ background: C.chipBg, color: '#6E6459' }}
              >
                {highlight.label} · {highlight.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
