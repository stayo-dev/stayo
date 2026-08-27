import { useEffect, useState } from 'react';
import { Footprints, X } from 'lucide-react';

import type { ReviewSummary } from '@features/discover/api';
import { StarRating } from '@shared/ui-patterns/StarRating';

import { C, FONT } from '../discoverTheme';
import { CATEGORY_ICONS } from './reviewCategoryMeta';

/**
 * Plain-language description of `review-summary.ts`'s actual rules — kept in
 * sync with that file by hand, since this is copy, not a shared import. Never
 * Airbnb's own text: this describes what Stayo's backend actually does.
 */
const HOW_REVIEWS_WORK = [
  'Only tenants who actually lived at a hostel can review it — checked against real tenancy records, not just an account that exists.',
  "Every review goes through Stayo's moderation before it's published, so anything you read here has already been checked.",
  "The overall rating is a plain average of every published review's own star rating. Cleanliness, Maintenance, Food, Room Comfort, Staff & Management, Safety and Wi-Fi are asked as separate questions and shown as their own averages — never blended into the overall score.",
  '"Resident Favourite" appears only once a hostel has at least 5 published reviews averaging 4.5 stars or higher.',
];

function HowReviewsWorkModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(20,16,13,.5)' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How reviews work"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-t-[22px] bg-white sm:rounded-[22px]"
        style={{ padding: '20px 20px calc(20px + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            className="text-[18px] font-extrabold tracking-tight"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            How reviews work
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full transition-colors hover:bg-black/[.05]"
            style={{ color: C.textBody }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3.5 flex flex-col gap-3">
          {HOW_REVIEWS_WORK.map((line) => (
            <p key={line} className="text-[13px] leading-[1.6]" style={{ color: C.textBody }}>
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The trust header, the star-distribution breakdown and the category grid —
 * everything above the review cards themselves. Only ever rendered when
 * `summary.average != null`: it never invents a score, so a caller must gate
 * on that before mounting this.
 *
 * A hostel that clears `isResidentFavourite` gets Airbnb's own treatment for
 * a qualifying listing — the score centred, flanked by footprints standing in
 * for Airbnb's laurels, with "Resident Favourite" as a heading rather than a
 * small pill. Everything else keeps the plain, compact rating line — the
 * elevated layout is earned, not the default (see `isResidentFavourite` in
 * `review-summary.ts`: 4.5+ average, 5+ reviews).
 *
 * `showCategoriesOnMobile` (default false) exists because this component
 * serves two different mobile experiences: the listing page's compact
 * preview, where a phone visitor is scanning and only needs the number, and
 * the dedicated Reviews page, which a phone visitor has explicitly navigated
 * to *for* the detail — the category breakdown belongs there at every width.
 */
export function ReviewsScoreSummary({
  summary,
  showCategoriesOnMobile = false,
}: {
  summary: ReviewSummary;
  showCategoriesOnMobile?: boolean;
}) {
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  return (
    <div className="mt-4">
      {/* Centered on every viewport, favourite or not — the footprints
          (Stayo's own stand-in for Airbnb's laurel wreath) always flank the
          number; only the heading beneath it changes on whether this hostel
          actually clears `isResidentFavourite`. Shown on mobile too (unlike
          the category grid below), since a resident scanning on a phone
          should still see the number their decision hinges on. */}
      <div className="flex flex-col items-center py-2 text-center">
        <div className="flex items-center gap-4 sm:gap-6">
          <Footprints className="h-7 w-7 flex-none sm:h-8 sm:w-8" strokeWidth={1.5} style={{ color: C.clay }} />
          <span
            className="text-[38px] font-extrabold leading-none tracking-[-0.02em] sm:text-[46px]"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            {summary.average!.toFixed(1)}
          </span>
          <Footprints
            className="h-7 w-7 flex-none scale-x-[-1] sm:h-8 sm:w-8"
            strokeWidth={1.5}
            style={{ color: C.clay }}
          />
        </div>

        {summary.isResidentFavourite ? (
          <p className="mt-3 text-[17px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
            Resident Favourite
          </p>
        ) : (
          <div className="mt-2">
            <StarRating value={Math.round(summary.average!)} size={17} color={C.clay} emptyColor="#DFD5C9" />
          </div>
        )}

        <p className="mt-1.5 max-w-[38ch] text-[12px] leading-[1.6]" style={{ color: C.textMuted }}>
          {summary.isResidentFavourite
            ? `This hostel is a resident favourite, based on ${summary.count} verified ${summary.count === 1 ? 'review' : 'reviews'} from tenants who actually lived here.`
            : `Based on ${summary.count} verified ${summary.count === 1 ? 'review' : 'reviews'} from tenants who actually lived here.`}
        </p>
        <button
          type="button"
          onClick={() => setHowItWorksOpen(true)}
          className="mt-2 text-[12px] font-bold underline underline-offset-4"
          style={{ color: C.text }}
        >
          How reviews work
        </button>
      </div>

      {/* Desktop-only on the listing preview, deliberately — the category
          breakdown is detail a resident wants once they're reading closely,
          not something a phone scan needs there; the number and heading
          above already carry the verdict. On the dedicated Reviews page
          (`showCategoriesOnMobile`), it shows at every width — a phone
          visitor there has already asked for the detail — scrolling
          horizontally below `lg:` the way it always did before that page
          had its own preview/full-page split, then wrapping at `lg:` and up.
          Airbnb's own layout is one row: an "Overall rating" column (the
          5-to-1 distribution, compact) sits beside each category column
          (label/number/icon) as equal siblings — not a full-width
          distribution block followed by a separate category row. */}
      {(summary.distribution.length > 0 || summary.categories.length > 0) && (
        <div
          className={
            showCategoriesOnMobile
              ? 'mt-5 flex flex-nowrap gap-x-8 gap-y-5 overflow-x-auto border-t pt-4 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden'
              : 'mt-5 hidden flex-wrap gap-x-8 gap-y-5 border-t pt-4 lg:flex'
          }
          style={{ borderColor: C.line }}
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

      {howItWorksOpen && <HowReviewsWorkModal onClose={() => setHowItWorksOpen(false)} />}
    </div>
  );
}
