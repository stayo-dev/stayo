import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

import type { MyReview } from '@features/discover/api';
import { StarRating } from '@shared/ui-patterns/StarRating';

import { C, FONT } from '../discoverTheme';
import { PrimaryButton } from './DiscoverShell';
import { CATEGORY_ICONS } from './reviewCategoryMeta';

/**
 * The write box, in two states: eligible-and-writing, and already written.
 *
 * `ReviewsSection` renders this only for someone who can actually use it, so
 * a visitor who has never lived here sees the reviews and nothing else,
 * never a locked box about why they may not write one (ADR-102).
 *
 * When `mine` exists and isn't being edited, it renders as a compact status
 * strip rather than a full card — it's the resident's own status, not
 * another public review, so it should read as quieter than the review grid
 * above it, not as a review card in its own right.
 */
export function ReviewsWriteForm({
  mine,
  tenancy,
  categories,
  pending,
  error,
  onSubmit,
}: {
  mine: MyReview | null;
  /** Whether they live here now or used to — the box says which. */
  tenancy: 'ACTIVE' | 'FORMER' | null;
  categories: { key: string; label: string }[];
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
      <div
        className="mt-4 flex items-center justify-between gap-3 rounded-[12px] border px-3.5 py-2.5"
        style={{ borderColor: C.lineSoft, background: C.paperWarm }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <StarRating value={mine.rating} size={12} color={C.clay} emptyColor="#DFD5C9" />
          <p
            className="flex min-w-0 items-center gap-1.5 truncate text-[11.5px]"
            style={{ color: mine.status === 'PUBLISHED' ? C.green : C.textMuted }}
          >
            {(mine.status === 'PENDING' || mine.status === 'CHANGES_REQUESTED') && (
              <Clock className="h-3 w-3 flex-none" strokeWidth={2} />
            )}
            <span className="truncate">Your review · {statusText}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex-none text-[11.5px] font-bold"
          style={{ color: C.clay }}
        >
          Edit
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

      <div className="mt-3 flex items-center gap-3">
        <PrimaryButton disabled={!complete || pending} onClick={() => onSubmit(overall, scores, body.trim() || null)}>
          {pending ? 'Sending…' : mine ? 'Send updated review' : 'Send review to Stayo'}
        </PrimaryButton>
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
