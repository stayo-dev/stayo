import { useEffect, useState } from 'react';
import { Clock, Lock, ShieldCheck, Star } from 'lucide-react';

import { useHostelReviews, useSubmitReview } from '@features/discover/hooks/useDiscover';
import type {
  HostelReview,
  MyReview,
  ReviewEligibility,
  ReviewSummary,
} from '@features/discover/api';

import { C, FONT } from '../discoverTheme';

/**
 * Resident reviews on a hostel listing, and the box for writing one.
 *
 * Three rules this encodes:
 *
 * 1. **Only residents write.** Current or former tenants *of this hostel* —
 *    the server decides (`review-eligibility.ts`) and says so in the payload,
 *    so the box can explain itself before anyone types rather than refusing a
 *    finished review. An account is not an experience.
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
  onSignIn,
}: {
  slug: string | undefined;
  hostelName: string;
  onSignIn: () => void;
}) {
  const { data, isLoading, isError } = useHostelReviews(slug);
  const submit = useSubmitReview(slug);

  /**
   * If the endpoint is unavailable, show nothing at all. A write box that
   * throws when someone finishes typing is worse than no section.
   */
  if (isError) return null;

  const summary = data?.summary;
  const reviews = data?.reviews ?? [];
  const mine = data?.mine ?? null;
  const categories = data?.categories ?? [];
  // `as const` keeps the fallback on the discriminated union rather than
  // widening `canReview` to `boolean`, which would stop it narrowing below.
  const eligibility: ReviewEligibility =
    data?.eligibility ?? ({ canReview: false, reason: 'SIGNED_OUT' } as const);

  return (
    <section className="mt-7">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="text-[15px] font-extrabold tracking-[-0.01em]"
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

      {summary?.average != null && <ScoreBlock summary={summary} />}

      {!isLoading && summary?.emptyReason === 'TOO_FEW' && (
        <p className="mt-2 text-[12px] leading-[1.55]" style={{ color: C.textMuted }}>
          Too few reviews to average yet — read them and judge for yourself.
        </p>
      )}

      {/* Why there is nothing here. A blank space reads as neglect; this reads
          as a rule, which is what it is. */}
      {!isLoading && summary?.emptyReason === 'NONE_YET' && (
        <div
          className="mt-3 rounded-2xl border p-4"
          style={{ background: '#F6F0E8', borderColor: '#EADFCF' }}
        >
          <p className="text-[12.5px] font-bold" style={{ color: C.text }}>
            No reviews yet
          </p>
          <p className="mt-1 text-[11.5px] leading-[1.6]" style={{ color: '#5A5147' }}>
            Only people who have lived at {hostelName} can review it, and Stayo checks each one
            before it appears — so this page shows real accounts of the place or nothing at all.
          </p>
        </div>
      )}

      {reviews.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}

      <ReviewBox
        mine={mine}
        eligibility={eligibility}
        categories={categories}
        hostelName={hostelName}
        pending={submit.isPending}
        error={(submit.error as any)?.response?.data?.message ?? null}
        onSignIn={onSignIn}
        onSubmit={(scores, body) => submit.mutate({ categories: scores, body })}
      />
    </section>
  );
}

/** The overall score and what it is made of — Airbnb's breakdown. */
function ScoreBlock({ summary }: { summary: ReviewSummary }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-3">
        <span
          className="text-[30px] font-extrabold leading-none tracking-[-0.02em]"
          style={{ fontFamily: FONT.display, color: C.text }}
        >
          {summary.average!.toFixed(1)}
        </span>
        <Stars value={Math.round(summary.average!)} size={16} />
      </div>

      {summary.categories.length > 0 && (
        <div className="mt-3.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {summary.categories.map((category) => (
            <div key={category.key} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: C.textBody }}>
                {category.label}
              </span>
              {/* A bar, not five stars: at this size a bar compares across rows
                  at a glance and stars do not. */}
              <span className="h-[3px] w-[72px] flex-none rounded-full" style={{ background: C.line }}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(category.average / 5) * 100}%`, background: C.clay }}
                />
              </span>
              <span
                className="w-7 flex-none text-right text-[12px] font-bold tabular-nums"
                style={{ fontFamily: FONT.display, color: C.text }}
              >
                {category.average.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className="flex-none"
          style={{
            width: size,
            height: size,
            color: star <= value ? C.clay : '#DFD5C9',
            fill: star <= value ? C.clay : 'transparent',
          }}
          strokeWidth={1.8}
        />
      ))}
    </span>
  );
}

function ReviewCard({ review }: { review: HostelReview }) {
  return (
    <article className="rounded-2xl border bg-white p-4" style={{ borderColor: C.line }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
            {review.author}
          </span>
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold"
            style={{ background: C.greenPale, color: C.green }}
          >
            <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.4} />
            {review.stayed_here ? 'LIVED HERE' : 'RESIDENT'}
          </span>
        </div>
        <Stars value={review.rating} />
      </div>

      {review.body && (
        <p className="mt-2 text-[12.5px] leading-[1.65]" style={{ color: C.textBody }}>
          {review.body}
        </p>
      )}

      {review.categories.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {review.categories.map((category) => (
            <span
              key={category.key}
              className="rounded-[7px] px-2 py-1 text-[10.5px] font-semibold"
              style={{ background: C.chipBg, color: '#6E6459' }}
            >
              {category.label} {category.rating}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * The write box, in four states: not signed in, signed in but never lived
 * here, eligible, and already written.
 *
 * The "never lived here" state is a sentence, not a hidden form. Someone who
 * cannot review should be told why in the place they expected to write —
 * silence there reads as a broken page.
 */
function ReviewBox({
  mine,
  eligibility,
  categories,
  hostelName,
  pending,
  error,
  onSignIn,
  onSubmit,
}: {
  mine: MyReview | null;
  eligibility: ReviewEligibility;
  categories: { key: string; label: string }[];
  hostelName: string;
  pending: boolean;
  error: string | null;
  onSignIn: () => void;
  onSubmit: (categories: Record<string, number>, body: string | null) => void;
}) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [body, setBody] = useState(mine?.body ?? '');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (mine) {
      setBody(mine.body ?? '');
      setEditing(false);
    }
  }, [mine?.id, mine?.status, mine?.body]);

  // `=== false` rather than `!`: an explicit literal comparison is what
  // narrows this union reliably to its not-allowed member.
  if (eligibility.canReview === false) {
    const signedOut = eligibility.reason === 'SIGNED_OUT';
    return (
      <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: C.line, background: C.cardWarm }}>
        <p className="flex items-center gap-1.5 text-[12.5px] font-bold" style={{ color: C.text }}>
          {!signedOut && <Lock className="h-3.5 w-3.5" strokeWidth={2} style={{ color: C.textMuted }} />}
          {signedOut ? 'Lived at this hostel?' : 'Only residents can review'}
        </p>
        <p className="mt-1 text-[11.5px] leading-[1.6]" style={{ color: C.textMuted }}>
          {signedOut
            ? `Sign in to write a review. Only current and former residents of ${hostelName} can review it.`
            : `Reviews here come from people who have actually lived at ${hostelName} — current residents and those who have moved out. That is what makes them worth reading.`}
        </p>
        {signedOut && (
          <button
            type="button"
            onClick={onSignIn}
            className="mt-3 rounded-[11px] px-4 py-2.5 text-[12.5px] font-bold text-white"
            style={{ background: C.clayDeep, fontFamily: FONT.display }}
          >
            Sign in
          </button>
        )}
      </div>
    );
  }

  if (mine && !editing) {
    const statusText =
      mine.status === 'PENDING'
        ? 'With Stayo for checking — it appears here once approved.'
        : mine.status === 'PUBLISHED'
          ? 'Published — this is live on the listing.'
          : mine.moderation_note
            ? `Not published. Stayo said: ${mine.moderation_note}`
            : 'Not published.';

    return (
      <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: C.line, background: C.cardWarm }}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] font-bold" style={{ color: C.text }}>Your review</span>
          <Stars value={mine.rating} />
        </div>
        {mine.body && (
          <p className="mt-2 text-[12.5px] leading-[1.65]" style={{ color: C.textBody }}>{mine.body}</p>
        )}
        <p
          className="mt-2.5 flex items-center gap-1.5 text-[11px]"
          style={{ color: mine.status === 'PUBLISHED' ? C.green : C.textMuted }}
        >
          {mine.status === 'PENDING' && <Clock className="h-3 w-3" strokeWidth={2} />}
          {statusText}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 text-[12px] font-bold"
          style={{ color: C.clay }}
        >
          Edit my review
        </button>
      </div>
    );
  }

  const answered = categories.filter((category) => scores[category.key]).length;
  const complete = categories.length > 0 && answered === categories.length;

  return (
    <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: C.line, background: C.cardWarm }}>
      <p className="text-[12.5px] font-bold" style={{ color: C.text }}>
        {mine ? 'Edit your review' : 'Rate your stay'}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: C.textMuted }}>
        {eligibility.tenancy === 'ACTIVE' ? 'You live here now.' : 'You lived here.'} Score each part —
        the overall rating is worked out from these.
      </p>

      <div className="mt-3 flex flex-col gap-2.5">
        {categories.map((category) => (
          <div key={category.key} className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: C.textBody }}>
              {category.label}
            </span>
            <span className="flex flex-none items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${category.label}: ${star} star${star > 1 ? 's' : ''}`}
                  aria-pressed={scores[category.key] === star}
                  onClick={() => setScores((current) => ({ ...current, [category.key]: star }))}
                  className="p-0.5 transition-transform active:scale-90"
                >
                  <Star
                    className="h-[19px] w-[19px]"
                    strokeWidth={1.8}
                    style={{
                      color: star <= (scores[category.key] ?? 0) ? C.clay : '#DFD5C9',
                      fill: star <= (scores[category.key] ?? 0) ? C.clay : 'transparent',
                    }}
                  />
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={1500}
        placeholder="What was it actually like to live here? The things you wish you had known."
        className="mt-3 w-full resize-none rounded-[12px] border bg-white p-3 text-[12.5px] leading-[1.6] outline-none"
        style={{ borderColor: C.lineInput, color: C.textBody }}
      />

      {error && (
        <p className="mt-2 text-[11.5px]" style={{ color: '#B3402F' }}>{error}</p>
      )}

      <p className="mt-2 text-[11px] leading-[1.55]" style={{ color: C.textMuted }}>
        Stayo reads every review before publishing it, so yours will not appear straight away.
        Editing a published review sends it back for checking.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!complete || pending}
          onClick={() => onSubmit(scores, body.trim() || null)}
          className="rounded-[11px] px-4 py-2.5 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: C.clayDeep, fontFamily: FONT.display }}
        >
          {pending ? 'Sending…' : mine ? 'Send updated review' : 'Send review to Stayo'}
        </button>
        {!complete && (
          <span className="text-[11px]" style={{ color: C.textMuted }}>
            {answered} of {categories.length} rated
          </span>
        )}
        {mine && complete && (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-[12px] font-semibold"
            style={{ color: C.textMuted }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
