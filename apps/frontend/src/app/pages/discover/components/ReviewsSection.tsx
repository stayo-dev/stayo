import { useEffect, useState } from 'react';
import { Clock, ShieldCheck, Star } from 'lucide-react';

import { useHostelReviews, useIsSeeker, useSubmitReview } from '@features/discover/hooks/useDiscover';
import type { HostelReview, MyReview } from '@features/discover/api';

import { C, FONT } from '../discoverTheme';

/**
 * Resident reviews on a hostel listing, and the box for writing one.
 *
 * Two things this deliberately does **not** do:
 *
 * 1. **It never invents a score.** Discovery has shown `ratings_available:
 *    false` since launch rather than printing a plausible number, and that
 *    rule survives the arrival of real reviews: below three, the reviews are
 *    shown but no average is (see `review-summary.ts`).
 * 2. **It never implies a review is live.** Everything written here goes to
 *    Stayo first, so the empty state says so and a submitted review is shown
 *    back to its author marked as waiting — not dropped into the list where it
 *    would look published to the person who wrote it.
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
  const { data, isLoading } = useHostelReviews(slug);
  const { isSeeker } = useIsSeeker();
  const submit = useSubmitReview(slug);

  const summary = data?.summary;
  const reviews = data?.reviews ?? [];
  const mine = data?.mine ?? null;

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

      {/* The score, only when the reviews can carry one. */}
      {summary?.average != null && (
        <div className="mt-3 flex items-center gap-3">
          <span
            className="text-[30px] font-extrabold leading-none tracking-[-0.02em]"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            {summary.average.toFixed(1)}
          </span>
          <Stars value={Math.round(summary.average)} size={16} />
        </div>
      )}

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
            Stayo checks every review before it appears here, so this page only ever shows real ones —
            and none have been published for {hostelName} yet. If you have stayed or visited, yours
            would be the first.
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
        isSeeker={isSeeker}
        pending={submit.isPending}
        error={(submit.error as any)?.response?.data?.message ?? null}
        onSignIn={onSignIn}
        onSubmit={(rating, body) => submit.mutate({ rating, body })}
      />
    </section>
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
          {review.stayed_here && (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold"
              style={{ background: C.greenPale, color: C.green }}
            >
              <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.4} />
              STAYED HERE
            </span>
          )}
        </div>
        <Stars value={review.rating} />
      </div>
      {review.body && (
        <p className="mt-2 text-[12.5px] leading-[1.65]" style={{ color: C.textBody }}>
          {review.body}
        </p>
      )}
    </article>
  );
}

/**
 * The write box.
 *
 * Signed out, it is an invitation to sign in rather than a form that throws
 * the writing away at the end — **only signed-in accounts may review**, and
 * discovering that after typing three paragraphs is the worst possible moment
 * to be told.
 */
function ReviewBox({
  mine,
  isSeeker,
  pending,
  error,
  onSignIn,
  onSubmit,
}: {
  mine: MyReview | null;
  isSeeker: boolean;
  pending: boolean;
  error: string | null;
  onSignIn: () => void;
  onSubmit: (rating: number, body: string | null) => void;
}) {
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? '');
  const [editing, setEditing] = useState(false);

  // A review loaded after first paint (or one just saved) seeds the form.
  useEffect(() => {
    if (mine) {
      setRating(mine.rating);
      setBody(mine.body ?? '');
      setEditing(false);
    }
  }, [mine?.id, mine?.status, mine?.rating, mine?.body]);

  if (!isSeeker) {
    return (
      <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: C.line, background: C.cardWarm }}>
        <p className="text-[12.5px] font-bold" style={{ color: C.text }}>
          Stayed or visited this hostel?
        </p>
        <p className="mt-1 text-[11.5px] leading-[1.6]" style={{ color: C.textMuted }}>
          Sign in to write a review. Reviews come from Stayo accounts only, and each one is checked
          before it appears.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-3 rounded-[11px] px-4 py-2.5 text-[12.5px] font-bold text-white"
          style={{ background: C.clayDeep, fontFamily: FONT.display }}
        >
          Sign in to review
        </button>
      </div>
    );
  }

  // Their review is already in, and not being edited: report its state rather
  // than showing an empty form that implies nothing was submitted.
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
          <span className="text-[12.5px] font-bold" style={{ color: C.text }}>
            Your review
          </span>
          <Stars value={mine.rating} />
        </div>
        {mine.body && (
          <p className="mt-2 text-[12.5px] leading-[1.65]" style={{ color: C.textBody }}>
            {mine.body}
          </p>
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

  return (
    <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: C.line, background: C.cardWarm }}>
      <p className="text-[12.5px] font-bold" style={{ color: C.text }}>
        {mine ? 'Edit your review' : 'Write a review'}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            aria-pressed={rating === star}
            onClick={() => setRating(star)}
            className="p-1 transition-transform active:scale-90"
          >
            <Star
              className="h-6 w-6"
              strokeWidth={1.8}
              style={{
                color: star <= rating ? C.clay : '#DFD5C9',
                fill: star <= rating ? C.clay : 'transparent',
              }}
            />
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={1500}
        placeholder="What was it actually like to live here? Rooms, food, staff, the things you wish you had known."
        className="mt-2.5 w-full resize-none rounded-[12px] border bg-white p-3 text-[12.5px] leading-[1.6] outline-none"
        style={{ borderColor: C.lineInput, color: C.textBody }}
      />

      {error && (
        <p className="mt-2 text-[11.5px]" style={{ color: '#B3402F' }}>
          {error}
        </p>
      )}

      <p className="mt-2 text-[11px] leading-[1.55]" style={{ color: C.textMuted }}>
        Stayo reads every review before publishing it. Yours will not appear on this page straight
        away, and editing a published review sends it back for checking.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={rating === 0 || pending}
          onClick={() => onSubmit(rating, body.trim() || null)}
          className="rounded-[11px] px-4 py-2.5 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: C.clayDeep, fontFamily: FONT.display }}
        >
          {pending ? 'Sending…' : mine ? 'Send updated review' : 'Send review to Stayo'}
        </button>
        {mine && (
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
