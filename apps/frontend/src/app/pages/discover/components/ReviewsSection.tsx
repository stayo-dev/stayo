import { useEffect, useState } from 'react';
import {
  Award,
  Boxes,
  Clock,
  ShieldCheck,
  ShowerHead,
  Sparkles,
  UtensilsCrossed,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react';

import { useHostelReviews, useSubmitReview } from '@features/discover/hooks/useDiscover';
import type {
  HostelReview,
  MyReview,
  ReviewEligibility,
  ReviewSummary,
} from '@features/discover/api';
import { StarRating } from '@shared/ui-patterns/StarRating';

import { C, FONT } from '../discoverTheme';

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
  const reviews = showAll ? allReviews : allReviews.slice(0, 6);
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

      {summary?.emptyReason === 'TOO_FEW' && (
        <p className="mt-2 text-[12px] leading-[1.55]" style={{ color: C.textMuted }}>
          Too few reviews to average yet — read them and judge for yourself.
        </p>
      )}

      {reviews.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}

      {!showAll && allReviews.length > reviews.length && (
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
        <ReviewBox
          mine={mine}
          tenancy={tenancy}
          categories={categories}
          hostelName={hostelName}
          pending={submit.isPending}
          error={(submit.error as any)?.response?.data?.message ?? null}
          onSubmit={(overall, scores, body) => submit.mutate({ overall, categories: scores, body })}
        />
      )}
    </section>
  );
}

/** A small icon per category — decoration, not information, so a missing key just renders nothing. */
const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  cleanliness: Sparkles,
  maintenance: Wrench,
  food: UtensilsCrossed,
  room_comfort: ShowerHead,
  amenities: Boxes,
  staff: Users,
  safety: ShieldCheck,
  wifi: Wifi,
};

/** Friendly tag for a highly-rated category — matches `deriveHighlights` on the backend. */
const HIGHLIGHT_LABELS: Record<string, string> = {
  cleanliness: 'Clean Rooms',
  maintenance: 'Well Maintained',
  food: 'Good Food',
  room_comfort: 'Comfortable Rooms',
  amenities: 'Good Amenities',
  staff: 'Helpful Staff',
  safety: 'Safe Environment',
  wifi: 'Good Wi-Fi',
};

/** The overall score and what it is made of — Airbnb's breakdown, Stayo's categories. */
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
        <div className="flex flex-col gap-1">
          <StarRating value={Math.round(summary.average!)} size={16} color={C.clay} emptyColor="#DFD5C9" />
          {summary.isResidentFavourite && (
            <span
              className="flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: C.greenPale, color: C.green }}
            >
              <Award className="h-2.5 w-2.5" strokeWidth={2.4} />
              RESIDENT FAVOURITE
            </span>
          )}
        </div>
      </div>

      {summary.categories.length > 0 && (
        <div className="mt-3.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {summary.categories.map((category) => {
            const Icon = CATEGORY_ICONS[category.key];
            return (
              <div key={category.key} className="flex items-center gap-2">
                {Icon && <Icon className="h-3 w-3 flex-none" strokeWidth={1.8} style={{ color: C.textGhost }} />}
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
            );
          })}
        </div>
      )}

      {summary.highlights.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: C.textMuted }}>
            Residents mention
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {summary.highlights.slice(0, 6).map((highlight) => (
              <span
                key={highlight.label}
                className="rounded-[7px] px-2.5 py-1.5 text-[11px] font-semibold"
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

function ReviewCard({ review }: { review: HostelReview }) {
  const tags = review.categories
    .filter((category) => category.rating != null && category.rating >= 4)
    .map((category) => HIGHLIGHT_LABELS[category.key])
    .filter(Boolean);

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
            {review.stay_duration ? `VERIFIED RESIDENT · ${review.stay_duration.toUpperCase()}` : review.stayed_here ? 'LIVED HERE' : 'RESIDENT'}
          </span>
        </div>
        <StarRating value={review.rating} color={C.clay} emptyColor="#DFD5C9" />
      </div>

      {review.body && (
        <p className="mt-2 text-[12.5px] leading-[1.65]" style={{ color: C.textBody }}>
          {review.body}
        </p>
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

/**
 * The write box, in two states: eligible-and-writing, and already written.
 *
 * `ReviewsSection` renders this only for someone who can actually use it, so
 * a visitor who has never lived here sees the reviews and nothing else,
 * never a locked box about why they may not write one (ADR-102).
 */
function ReviewBox({
  mine,
  tenancy,
  categories,
  hostelName,
  pending,
  error,
  onSubmit,
}: {
  mine: MyReview | null;
  /** Whether they live here now or used to — the box says which. */
  tenancy: 'ACTIVE' | 'FORMER' | null;
  categories: { key: string; label: string }[];
  hostelName: string;
  pending: boolean;
  error: string | null;
  onSubmit: (overall: number, categories: Record<string, number>, body: string | null) => void;
}) {
  const [overall, setOverall] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [body, setBody] = useState(mine?.body ?? '');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (mine) {
      setBody(mine.body ?? '');
      setEditing(false);
    }
  }, [mine?.id, mine?.status, mine?.body]);

  if (mine && !editing) {
    const statusText =
      mine.status === 'PENDING'
        ? 'With Stayo for checking — it appears here once approved.'
        : mine.status === 'PUBLISHED'
          ? 'Published — this is live on the listing.'
          : mine.status === 'CHANGES_REQUESTED'
            ? `Stayo asked for changes: ${mine.moderation_note ?? 'see the note below.'} Edit and resend.`
            : mine.moderation_note
              ? `Not published. Stayo said: ${mine.moderation_note}`
              : 'Not published.';

    return (
      <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: C.line, background: C.cardWarm }}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] font-bold" style={{ color: C.text }}>Your review</span>
          <StarRating value={mine.rating} color={C.clay} emptyColor="#DFD5C9" />
        </div>
        {mine.body && (
          <p className="mt-2 text-[12.5px] leading-[1.65]" style={{ color: C.textBody }}>{mine.body}</p>
        )}
        <p
          className="mt-2.5 flex items-center gap-1.5 text-[11px]"
          style={{ color: mine.status === 'PUBLISHED' ? C.green : C.textMuted }}
        >
          {(mine.status === 'PENDING' || mine.status === 'CHANGES_REQUESTED') && (
            <Clock className="h-3 w-3" strokeWidth={2} />
          )}
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
  const complete = categories.length > 0 && answered === categories.length && overall > 0;

  return (
    <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: C.line, background: C.cardWarm }}>
      <p className="text-[12.5px] font-bold" style={{ color: C.text }}>
        {mine ? 'Edit your review' : 'Rate your stay'}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: C.textMuted }}>
        {tenancy === 'ACTIVE' ? 'You live here now.' : 'You lived here.'} Tell us about your overall
        experience, then score each part of it.
      </p>

      <div className="mt-3 flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: C.line }}>
        <span className="text-[12.5px] font-bold" style={{ color: C.textBody }}>
          Overall Experience
        </span>
        <StarRating
          value={overall}
          size={19}
          color={C.clay}
          emptyColor="#DFD5C9"
          label="Overall Experience"
          onRate={setOverall}
        />
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.key];
          return (
            <div key={category.key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[12.5px]" style={{ color: C.textBody }}>
                {Icon && <Icon className="h-3.5 w-3.5 flex-none" strokeWidth={1.8} style={{ color: C.textGhost }} />}
                {category.label}
              </span>
              <StarRating
                value={scores[category.key] ?? 0}
                size={19}
                color={C.clay}
                emptyColor="#DFD5C9"
                label={category.label}
                onRate={(star) => setScores((current) => ({ ...current, [category.key]: star }))}
              />
            </div>
          );
        })}
      </div>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={1500}
        placeholder="Tell us about your experience staying here"
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
          onClick={() => onSubmit(overall, scores, body.trim() || null)}
          className="rounded-[11px] px-4 py-2.5 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: C.clayDeep, fontFamily: FONT.display }}
        >
          {pending ? 'Sending…' : mine ? 'Send updated review' : 'Send review to Stayo'}
        </button>
        {!complete && (
          <span className="text-[11px]" style={{ color: C.textMuted }}>
            {overall === 0 ? 'Rate your overall experience' : `${answered} of ${categories.length} rated`}
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
