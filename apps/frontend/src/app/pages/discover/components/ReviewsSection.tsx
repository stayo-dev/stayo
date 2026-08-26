import { useState } from 'react';

import { useHostelReviews, useSubmitReview } from '@features/discover/hooks/useDiscover';
import type { ReviewEligibility } from '@features/discover/api';

import { C, FONT } from '../discoverTheme';
import { getReviewPreview } from '../reviewsPreview';
import { ReviewsCard } from './ReviewsCard';
import { ReviewsScoreSummary } from './ReviewsScoreSummary';
import { ReviewsWriteForm } from './ReviewsWriteForm';

/**
 * Resident reviews on a hostel listing, and the box for writing one.
 *
 * **The section is not rendered at all unless it has something to say.** If
 * there are no published reviews and this reader cannot write one, there is no
 * heading, no empty state and no explanation of the rules — a visitor browsing
 * a new hostel is not owed a paragraph about Stayo's moderation policy in the
 * place where reviews would be. It appears when there are reviews to read, or
 * when the person looking is a resident who can add one. See ADR-102.
 *
 * Three rules it still encodes:
 *
 * 1. **Only residents write.** Current or former tenants *of this hostel* —
 *    the server decides (`review-eligibility.ts`) and says so in the payload,
 *    so the box appears only for someone who can actually use it. An account
 *    is not an experience.
 * 2. **It never invents a score.** Below three reviews the listing shows the
 *    reviews and no average — the same rule that had Discovery returning
 *    `ratings_available: false` rather than a plausible number.
 * 3. **It never implies a review is live.** Everything written here goes to
 *    Stayo first; a submitted review is shown back to its author marked as
 *    waiting, not dropped into the public list.
 */
export function ReviewsSection({
  slug,
  hostelName,
}: {
  slug: string | undefined;
  hostelName: string;
}) {
  const { data, isLoading, isError } = useHostelReviews(slug);
  const submit = useSubmitReview(slug);
  const [showAll, setShowAll] = useState(false);

  /**
   * If the endpoint is unavailable, show nothing at all. A write box that
   * throws when someone finishes typing is worse than no section.
   */
  if (isError) return null;

  const summary = data?.summary;
  const allReviews = data?.reviews ?? [];
  const preview = getReviewPreview(allReviews, showAll);
  const mine = data?.mine ?? null;
  const categories = data?.categories ?? [];
  // `as const` keeps the fallback on the discriminated union rather than
  // widening `canReview` to `boolean`, which would stop it narrowing below.
  const eligibility: ReviewEligibility =
    data?.eligibility ?? ({ canReview: false, reason: 'SIGNED_OUT' } as const);

  const canWrite = eligibility.canReview === true;
  /**
   * `'tenancy' in x` rather than a `canReview === true` check: this app
   * compiles with `strict: false`, where TypeScript will not narrow a
   * discriminated union on its boolean tag, so `eligibility.tenancy` is an
   * error at every call site. An `in` guard narrows either way.
   */
  const tenancy = 'tenancy' in eligibility ? eligibility.tenancy : null;

  /**
   * Nothing to read and nothing this person can do about it — so nothing at
   * all (ADR-102). `isLoading` keeps it collapsed until the answer is known,
   * rather than flashing a heading that then disappears.
   */
  if (isLoading || (allReviews.length === 0 && !canWrite && !mine)) return null;

  return (
    <section className="mt-7">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="text-[16px] font-extrabold tracking-[-0.01em]"
          style={{ fontFamily: FONT.display, color: C.text }}
        >
          Reviews
        </h2>
        {summary && summary.count > 0 && (
          <span className="text-[12px]" style={{ color: C.textMuted }}>
            {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
          </span>
        )}
      </div>

      {summary?.average != null && <ReviewsScoreSummary summary={summary} />}

      {summary?.emptyReason === 'TOO_FEW' && (
        <p className="mt-2 text-[12px] leading-[1.55]" style={{ color: C.textMuted }}>
          Too few reviews to average yet — read them and judge for yourself.
        </p>
      )}

      {/* Only reachable when the top gate already let the section through —
          an eligible resident or someone with a review already in flight —
          so this never doubles as a reason to show the section to a visitor
          who cannot write one. */}
      {summary?.emptyReason === 'NONE_YET' && (
        <div
          className="mt-3 rounded-2xl border p-4"
          style={{ background: '#F6F0E8', borderColor: '#EADFCF' }}
        >
          <p className="text-[12.5px] font-bold" style={{ color: C.text }}>
            No reviews yet
          </p>
          <p className="mt-1 text-[11.5px] leading-[1.6]" style={{ color: '#5A5147' }}>
            Be the first to tell people what it's actually like to live at {hostelName}.
          </p>
        </div>
      )}

      {preview.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {preview.map((review) => (
            <ReviewsCard key={review.id} review={review} />
          ))}
        </div>
      )}

      {!showAll && allReviews.length > preview.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 rounded-[11px] border px-4 py-2.5 text-[12.5px] font-bold"
          style={{ borderColor: C.line, color: C.text, fontFamily: FONT.display }}
        >
          Show all {allReviews.length} reviews
        </button>
      )}

      {/* Only for someone who can actually use it. A reader who has never
          lived here is shown the reviews and nothing else — no locked box
          explaining why they may not write one. */}
      {(canWrite || mine) && (
        <ReviewsWriteForm
          mine={mine}
          tenancy={tenancy}
          categories={categories}
          pending={submit.isPending}
          error={(submit.error as any)?.response?.data?.message ?? null}
          onSubmit={(overall, scores, body) => submit.mutate({ overall, categories: scores, body })}
        />
      )}
    </section>
  );
}
