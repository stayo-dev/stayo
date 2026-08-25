import { useState } from 'react';
import { Check, MessageSquareWarning, ShieldCheck, Star, X } from 'lucide-react';

import { useModerateReview, useReviewQueue } from '@features/hostel-reviews/hooks/useReviewModeration';
import type { AdminReview } from '@features/hostel-reviews/api';
import { EmptyState, FilterChips, SegmentedTabs } from '../ui';
import { useToast } from '../layout/toastContext';
import { ReviewInsightsPanel } from './ReviewInsightsPanel';

const TABS = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'REJECTED', label: 'Rejected' },
] as const;

/**
 * The category scores behind a review's overall star, for the moderator.
 *
 * The overall star is now given directly by the resident (ADR-115) rather
 * than derived, but the breakdown still matters: it hides a 1-star for food
 * under a 5 for cleanliness. A reviewer alleging filthy kitchens and one
 * grumbling about slow Wi-Fi are different moderation decisions, and this is
 * what tells them apart at a glance.
 */
const CATEGORY_LABELS: [keyof AdminReview, string][] = [
  ['rating_cleanliness', 'Cleanliness'],
  ['rating_maintenance', 'Maintenance'],
  ['rating_food', 'Food'],
  ['rating_room_comfort', 'Room Comfort'],
  ['rating_amenities', 'Amenities'],
  ['rating_staff', 'Staff & Management'],
  ['rating_safety', 'Safety'],
  ['rating_wifi', 'Wi-Fi'],
];

const SENTIMENT_STYLE: Record<string, { bg: string; color: string }> = {
  POSITIVE: { bg: '#EAF3EE', color: '#1F7A52' },
  NEUTRAL: { bg: '#F2ECE5', color: '#6E5B4E' },
  NEGATIVE: { bg: '#FBE9E5', color: '#B3402F' },
};

/**
 * Review moderation — the gate every resident review passes through — and,
 * as a separate tab, review insights: what residents are actually saying.
 *
 * A review written on a hostel's listing is not published by writing it. It
 * lands here, and a person at Stayo decides. That is the whole design (ADR-086):
 * the listing carries a real business's name, Stayo's verification badge and an
 * enquiry button, so an unmoderated text field on it is a liability to the
 * hostel and to Stayo alike.
 *
 * Deliberately **not** delegated to the hostel's owner. An owner choosing which
 * reviews of their own hostel appear is not a review system, it is a
 * testimonial page — and a reader can tell the difference.
 *
 * Moderation and insights are two separate questions over the same data
 * (ADR-115): "should this be published" versus "what are residents talking
 * about". A review's detected topics/sentiment below are shown to the
 * moderator for context only — they never decide the verdict.
 */
export function ReviewsPage() {
  const [view, setView] = useState<'moderation' | 'insights'>('moderation');
  const [tab, setTab] = useState<string>('PENDING');
  const [rejecting, setRejecting] = useState<{ id: string; verdict: 'REJECT' | 'REQUEST_CHANGES' } | null>(null);
  const [note, setNote] = useState('');

  const queue = useReviewQueue(tab);
  const moderate = useModerateReview();
  const fireToast = useToast();

  const decide = (review: AdminReview, verdict: 'PUBLISH' | 'REJECT' | 'REQUEST_CHANGES', reason?: string) => {
    moderate.mutate(
      { id: review.id, verdict, note: reason ?? null },
      {
        onSuccess: () => {
          fireToast(
            verdict === 'PUBLISH' ? 'Published to the listing' : verdict === 'REJECT' ? 'Rejected' : 'Changes requested',
          );
          setRejecting(null);
          setNote('');
        },
        onError: (error: any) =>
          fireToast(error?.response?.data?.message ?? 'Could not save that decision', 'no'),
      },
    );
  };

  const reviews = queue.data?.reviews ?? [];

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-4">
      <SegmentedTabs
        tabs={[
          { key: 'moderation', label: 'Moderation' },
          { key: 'insights', label: 'Insights' },
        ]}
        active={view}
        onChange={(key) => setView(key as 'moderation' | 'insights')}
      />

      {view === 'insights' ? (
        <ReviewInsightsPanel />
      ) : (
        <>
          <p className="text-[13px] text-[#8A7F75]">
            Resident reviews wait here. Nothing appears on a hostel's listing until you publish it.
          </p>

          <FilterChips
            chips={TABS.map((t) => ({ key: t.key, label: t.label, count: queue.data?.counts?.[t.key] }))}
            active={tab}
            onChange={setTab}
          />

          {queue.isLoading ? (
            <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading reviews…</div>
          ) : reviews.length === 0 ? (
            <EmptyState
              title={tab === 'PENDING' ? 'Nothing waiting 🎉' : 'Nothing here'}
              message={
                tab === 'PENDING'
                  ? 'Reviews written on a hostel listing land here for checking before they go public.'
                  : 'No reviews in this state yet.'
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.map((review) => (
                <article
                  key={review.id}
                  className="rounded-2xl border border-[#E6DCD1] bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-admin text-[14px] font-bold text-[#221E1A]">
                          {review.hostel.name}
                        </span>
                        {review.hostel.city && (
                          <span className="text-[12px] text-[#8A7F75]">{review.hostel.city}</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[#8A7F75]">
                        <span>{review.profile.name || 'Unnamed account'}</span>
                        {review.profile.email && <span>· {review.profile.email}</span>}
                        {review.stayed_here && (
                          <span className="flex items-center gap-1 rounded-full bg-[#EAF3EE] px-2 py-0.5 text-[10px] font-bold text-[#1F7A52]">
                            <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.4} />
                            {review.stay_months
                              ? `HELD A TENANCY · ${review.stay_months} MO`
                              : 'HELD A TENANCY HERE'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className="h-3.5 w-3.5"
                          strokeWidth={1.8}
                          style={{
                            color: star <= review.rating ? '#B46A55' : '#DFD5C9',
                            fill: star <= review.rating ? '#B46A55' : 'transparent',
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* The breakdown, so a moderator sees which part of the stay the
                      review is actually about. */}
                  {CATEGORY_LABELS.some(([key]) => review[key] != null) && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {CATEGORY_LABELS.filter(([key]) => review[key] != null).map(([key, label]) => {
                        const score = review[key] as number;
                        return (
                          <span
                            key={String(key)}
                            className="rounded-md px-2 py-1 text-[11px] font-semibold"
                            style={{
                              // A low score is not a rejection reason — it is the
                              // thing most worth reading before deciding.
                              background: score <= 2 ? '#FBE9E5' : '#F2ECE5',
                              color: score <= 2 ? '#B3402F' : '#6E5B4E',
                            }}
                          >
                            {label} {score}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {review.body ? (
                    <p className="mt-2.5 whitespace-pre-line text-[13px] leading-relaxed text-[#4A433C]">
                      {review.body}
                    </p>
                  ) : (
                    <p className="mt-2.5 text-[12.5px] italic text-[#A2978B]">
                      A rating with no written review.
                    </p>
                  )}

                  {/* Automatically detected topics + sentiment — context for the
                      moderator, never a factor in the verdict (ADR-115). */}
                  {review.topics.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {review.topics.map((topic) => {
                        const style = SENTIMENT_STYLE[topic.sentiment] ?? SENTIMENT_STYLE.NEUTRAL;
                        const label = CATEGORY_LABELS.find(([key]) => key === `rating_${topic.category}`)?.[1]
                          ?? topic.category;
                        return (
                          <span
                            key={topic.category}
                            className="rounded-md px-2 py-1 text-[10.5px] font-semibold"
                            style={{ background: style.bg, color: style.color }}
                          >
                            {label} · {topic.sentiment.toLowerCase()}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {(review.status === 'REJECTED' || review.status === 'CHANGES_REQUESTED') && review.moderation_note && (
                    <p className="mt-2 rounded-xl bg-[#FBF1DE] px-3 py-2 text-[12px] text-[#6E5B4E]">
                      {review.status === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Rejected'}: {review.moderation_note}
                    </p>
                  )}

                  {rejecting?.id === review.id ? (
                    <div className="mt-3">
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={2}
                        maxLength={500}
                        autoFocus
                        placeholder={
                          rejecting.verdict === 'REQUEST_CHANGES'
                            ? 'What should the author change? They see this.'
                            : 'Why is this not being published? The author sees this.'
                        }
                        className="w-full resize-none rounded-xl border border-[#E6DCD1] p-2.5 text-[12.5px] outline-none"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={moderate.isPending}
                          onClick={() => decide(review, rejecting.verdict, note.trim() || undefined)}
                          className="rounded-lg bg-[#B3402F] px-3.5 py-2 font-admin text-[12.5px] font-bold text-white disabled:opacity-60"
                        >
                          {rejecting.verdict === 'REQUEST_CHANGES' ? 'Send request' : 'Confirm rejection'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejecting(null);
                            setNote('');
                          }}
                          className="text-[12.5px] font-semibold text-[#8A7F75]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {review.status !== 'PUBLISHED' && (
                          <button
                            type="button"
                            disabled={moderate.isPending}
                            onClick={() => decide(review, 'PUBLISH')}
                            className="flex items-center gap-1.5 rounded-lg bg-[#1F7A52] px-3.5 py-2 font-admin text-[12.5px] font-bold text-white disabled:opacity-60"
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                            Publish to listing
                          </button>
                        )}
                        {review.status !== 'REJECTED' && (
                          <button
                            type="button"
                            disabled={moderate.isPending}
                            onClick={() => setRejecting({ id: review.id, verdict: 'REJECT' })}
                            className="flex items-center gap-1.5 rounded-lg border border-[#E6DCD1] px-3.5 py-2 font-admin text-[12.5px] font-bold text-[#221E1A] disabled:opacity-60"
                          >
                            <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                            {review.status === 'PUBLISHED' ? 'Take down' : 'Reject'}
                          </button>
                        )}
                        {review.status !== 'CHANGES_REQUESTED' && review.status !== 'PUBLISHED' && (
                          <button
                            type="button"
                            disabled={moderate.isPending}
                            onClick={() => setRejecting({ id: review.id, verdict: 'REQUEST_CHANGES' })}
                            className="flex items-center gap-1.5 rounded-lg border border-[#E6DCD1] px-3.5 py-2 font-admin text-[12.5px] font-bold text-[#221E1A] disabled:opacity-60"
                          >
                            <MessageSquareWarning className="h-3.5 w-3.5" strokeWidth={2.4} />
                            Request changes
                          </button>
                        )}
                      {review.hostel.public_slug && (
                        <a
                          href={`/discover/h/${review.hostel.public_slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12.5px] font-semibold text-[#B46A55]"
                        >
                          Open listing
                        </a>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
