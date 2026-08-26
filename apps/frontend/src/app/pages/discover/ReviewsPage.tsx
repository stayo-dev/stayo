import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';

import { useHostelReviews } from '@features/discover/hooks/useDiscover';

import { C, FONT, PAGE_SHELL } from './discoverTheme';
import { ReviewsCard } from './components/ReviewsCard';
import { ReviewsScoreSummary } from './components/ReviewsScoreSummary';
import { ReviewsSortControl } from './components/ReviewsSortControl';
import { searchReviews } from './reviewSearch';
import { sortReviews, type ReviewSortMode } from './reviewSort';

/**
 * The dedicated Reviews page — the complete review experience, reached only
 * from the listing page's "Show all N reviews" button. Everything the
 * listing's compact preview deliberately leaves out lives here: the trust
 * score, the distribution/category breakdown, sort, search, and the full
 * untruncated list. See `ReviewsSection.tsx` for what stays on the listing
 * page instead.
 */
export function ReviewsPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data, isLoading } = useHostelReviews(slug);

  const seeded = (location.state ?? {}) as { hostelName?: string };
  const hostelName = seeded.hostelName ?? 'this hostel';

  const [sortMode, setSortMode] = useState<ReviewSortMode>('relevant');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const summary = data?.summary;
  const allReviews = data?.reviews ?? [];

  const visibleReviews = useMemo(() => {
    const bySearch = searchReviews(allReviews, debouncedQuery);
    return sortReviews(bySearch, sortMode);
  }, [allReviews, debouncedQuery, sortMode]);

  /**
   * A Reviews page URL is plausible to bookmark, share, or open in a new
   * tab — unlike the Enquiry flow, which is only ever reached by a button
   * click from the listing. So this mirrors `ListingPage.tsx`'s own more
   * defensive `goBack` (falling back to the listing route when there's no
   * history to go back to) rather than `EnquiryPage.tsx`'s bare
   * `navigate(-1)`.
   */
  const goBack = () => {
    if (location.key === 'default') navigate(`/discover/h/${slug}`);
    else navigate(-1);
  };

  return (
    <div className="min-h-[100dvh]" style={{ background: C.paper }}>
      <header
        className="flex items-center gap-3 border-b px-5 pb-3.5 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={goBack}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <div className="min-w-0">
          <h1 className="text-[18px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
            Reviews
          </h1>
          <p className="truncate text-[11.5px]" style={{ color: C.textMuted }}>
            {hostelName}
          </p>
        </div>
      </header>

      <main className={`${PAGE_SHELL} py-6`}>
        {!isLoading && summary?.average != null && <ReviewsScoreSummary summary={summary} />}

        {!isLoading && summary?.emptyReason === 'TOO_FEW' && (
          <p className="mt-2 text-[12px] leading-[1.55]" style={{ color: C.textMuted }}>
            Too few reviews to average yet — read them and judge for yourself.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5" style={{ borderColor: C.lineSoft }}>
          <h2 className="text-[15px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
            {allReviews.length} {allReviews.length === 1 ? 'review' : 'reviews'}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-2 rounded-full border bg-white px-3.5 py-2"
              style={{ borderColor: C.lineInput }}
            >
              <Search className="h-3.5 w-3.5 flex-none" style={{ color: C.textGhost }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reviews"
                aria-label="Search reviews"
                className="w-[9.5rem] bg-transparent text-[12.5px] outline-none"
                style={{ color: C.text }}
              />
            </div>
            <ReviewsSortControl mode={sortMode} onChange={setSortMode} />
          </div>
        </div>

        {visibleReviews.length > 0 ? (
          <div className="mt-4 flex flex-col gap-4">
            {visibleReviews.map((review) => (
              <ReviewsCard key={review.id} review={review} truncate={false} />
            ))}
          </div>
        ) : (
          !isLoading && (
            <p className="mt-6 text-[12.5px]" style={{ color: C.textMuted }}>
              No reviews match this filter.
            </p>
          )
        )}
      </main>
    </div>
  );
}
