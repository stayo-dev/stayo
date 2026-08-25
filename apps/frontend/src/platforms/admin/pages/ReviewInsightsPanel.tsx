import { useState } from 'react';
import { Star } from 'lucide-react';

import { useReviewInsights } from '@features/hostel-reviews/hooks/useReviewModeration';
import type { ReviewSentiment } from '@features/hostel-reviews/api';
import { EmptyState, FilterChips, StatCard } from '../ui';

const SENTIMENT_TABS: { key: 'ALL' | ReviewSentiment; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'POSITIVE', label: 'Positive' },
  { key: 'NEUTRAL', label: 'Neutral' },
  { key: 'NEGATIVE', label: 'Negative' },
];

const SENTIMENT_STYLE: Record<string, { bg: string; color: string }> = {
  POSITIVE: { bg: '#EAF3EE', color: '#1F7A52' },
  NEUTRAL: { bg: '#F2ECE5', color: '#6E5B4E' },
  NEGATIVE: { bg: '#FBE9E5', color: '#B3402F' },
};

/**
 * "What are residents talking about" — separate from the moderation queue,
 * which answers "should this be published" (ADR-115). Reads the automatic
 * topic/sentiment detection produced at submit time, filterable by category
 * and sentiment, so an owner-facing operational problem (slow Wi-Fi after
 * 8pm, thin breakfast variety) surfaces without reading every review by hand.
 */
export function ReviewInsightsPanel() {
  const [category, setCategory] = useState<string>('ALL');
  const [sentiment, setSentiment] = useState<'ALL' | ReviewSentiment>('ALL');

  const insights = useReviewInsights({
    category: category === 'ALL' ? undefined : category,
    sentiment: sentiment === 'ALL' ? undefined : sentiment,
  });

  const categories = insights.data?.categories ?? [];
  const comments = insights.data?.comments ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-[#8A7F75]">
        What residents are actually saying, across every review Stayo has received — not just the
        ones published yet. A negative note here is a signal for the hostel, not a moderation
        decision.
      </p>

      <FilterChips
        chips={[
          { key: 'ALL', label: 'All Comments', count: categories.reduce((total, c) => total + c.mentions, 0) },
          ...categories.map((c) => ({ key: c.key, label: c.label, count: c.mentions })),
        ]}
        active={category}
        onChange={setCategory}
      />

      <FilterChips
        chips={SENTIMENT_TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
        active={sentiment}
        onChange={(key) => setSentiment(key as 'ALL' | ReviewSentiment)}
      />

      {insights.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading insights…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => (
              <StatCard
                key={c.key}
                label={c.label}
                value={c.averageRating != null ? c.averageRating.toFixed(1) : '—'}
                sub={`${c.mentions} mention${c.mentions === 1 ? '' : 's'} · ${c.positive} pos · ${c.neutral} neu · ${c.negative} neg`}
                valueTone={c.negative > c.positive && c.mentions > 0 ? 'red' : 'ink'}
              />
            ))}
          </div>

          {comments.length === 0 ? (
            <EmptyState
              title="Nothing here"
              message="No comments match this category and sentiment yet."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {comments.map((comment, index) => {
                const style = SENTIMENT_STYLE[comment.sentiment] ?? SENTIMENT_STYLE.NEUTRAL;
                return (
                  <article
                    key={`${comment.review.id}-${comment.category}-${index}`}
                    className="rounded-2xl border border-[#E6DCD1] bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-admin text-[13px] font-bold text-[#221E1A]">
                          {comment.review.hostel.name}
                        </span>
                        <span className="text-[11.5px] text-[#8A7F75]">{comment.review.author}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-md px-2 py-1 text-[10.5px] font-semibold"
                          style={{ background: style.bg, color: style.color }}
                        >
                          {comment.category} · {comment.sentiment.toLowerCase()}
                        </span>
                        <span className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className="h-3 w-3"
                              strokeWidth={1.8}
                              style={{
                                color: star <= comment.review.rating ? '#B46A55' : '#DFD5C9',
                                fill: star <= comment.review.rating ? '#B46A55' : 'transparent',
                              }}
                            />
                          ))}
                        </span>
                      </div>
                    </div>
                    {comment.review.body && (
                      <p className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-[#4A433C]">
                        {comment.review.body}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
