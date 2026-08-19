import type { MarketingEditorState, RevisionStatus } from '@features/hostel-marketing/api';

/**
 * Where a listing stands in the review cycle, in the owner's terms.
 *
 * The page used to derive its badge from `draft.status` alone, which is not
 * the whole truth: after approval there is no open revision at all, so the
 * status read `DRAFT` and the page said "Draft" about a listing that was live
 * on Discovery. An owner who had just submitted saw no confirmation that
 * anything was with Stayo, and an owner whose listing was live could not tell
 * whether their latest edits were live too.
 *
 * The real state needs three facts, not one: the open revision's status, what
 * is currently published, and whether the owner has unsaved edits on top.
 *
 * PURE — runs under vitest's node environment.
 */

export type LifecycleKey =
  /** Nothing submitted yet, nothing live. */
  | 'DRAFT'
  /** Submitted, waiting on Stayo. Nothing live yet. */
  | 'IN_REVIEW'
  /** Live, and the live version is the owner's latest work. */
  | 'LIVE'
  /** Live, with a newer version currently with Stayo. */
  | 'LIVE_IN_REVIEW'
  /** Live, with edits the owner has not sent for review. */
  | 'LIVE_EDITED'
  /** Stayo asked for changes; nothing new is with them. */
  | 'CHANGES_REQUESTED';

export interface Lifecycle {
  key: LifecycleKey;
  /** The one-word state, for the badge. */
  label: string;
  /** The sentence under it: what has happened and what happens next. */
  detail: string;
  /** Which of the three steps is current — used to draw the tracker. */
  step: 0 | 1 | 2;
  /** True while Stayo holds the listing. */
  withStayo: boolean;
  /** True when anything at all is publicly visible. */
  isLive: boolean;
  /** What the primary button should say and do. */
  action: 'SUBMIT' | 'WITHDRAW' | 'RESUBMIT' | 'NONE';
}

const STEP_LABELS = ['Draft', 'With Stayo', 'Live'] as const;
export const LIFECYCLE_STEPS = STEP_LABELS;

function whenText(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return ` on ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export function listingLifecycle(
  state: Pick<MarketingEditorState, 'draft' | 'published' | 'last_rejection'> | undefined,
  /** The owner has typed something the server has not seen. */
  dirty: boolean,
): Lifecycle {
  const draftStatus: RevisionStatus = state?.draft.status ?? 'DRAFT';
  const published = state?.published ?? null;
  const rejection = state?.last_rejection ?? null;

  if (draftStatus === 'PENDING_REVIEW') {
    const submitted = whenText(state?.draft.submitted_at);
    return {
      key: published ? 'LIVE_IN_REVIEW' : 'IN_REVIEW',
      label: 'In review',
      detail: published
        ? `v${published.version} stays live while Stayo checks your changes${submitted ? ` — sent${submitted}` : ''}.`
        : `Sent to Stayo${submitted}. They'll approve it or ask for changes, and you'll see the result here.`,
      step: 1,
      withStayo: true,
      isLive: Boolean(published),
      action: 'WITHDRAW',
    };
  }

  // A rejection only still applies while nothing newer has been approved.
  const rejectionIsCurrent =
    Boolean(rejection) && (!published || (rejection?.version ?? 0) > published.version);

  if (rejectionIsCurrent) {
    return {
      key: 'CHANGES_REQUESTED',
      label: 'Changes requested',
      detail: published
        ? `Stayo asked for changes${whenText(rejection?.reviewed_at)}. v${published.version} is still live until you send a new version.`
        : `Stayo asked for changes${whenText(rejection?.reviewed_at)}. Make them and send it back.`,
      step: 0,
      withStayo: false,
      isLive: Boolean(published),
      action: 'RESUBMIT',
    };
  }

  if (published) {
    // An open DRAFT beside a published version means work in progress that
    // nobody has reviewed — the live listing is not what the owner is looking
    // at, and saying "Live" flat would hide that.
    const hasUnsentEdits = dirty || Boolean(state?.draft.id);
    return hasUnsentEdits
      ? {
          key: 'LIVE_EDITED',
          label: 'Edits not sent',
          detail: `v${published.version} is live. Your changes go live only after Stayo reviews them — send them when you're ready.`,
          step: 0,
          withStayo: false,
          isLive: true,
          action: 'SUBMIT',
        }
      : {
          key: 'LIVE',
          label: 'Live',
          detail: `v${published.version} was approved${whenText(published.reviewed_at)} and is on Discovery now.`,
          step: 2,
          withStayo: false,
          isLive: true,
          action: 'NONE',
        };
  }

  return {
    key: 'DRAFT',
    label: 'Draft',
    detail: 'Only you can see this. Send it to Stayo when it is ready — every version is reviewed before it goes live.',
    step: 0,
    withStayo: false,
    isLive: false,
    action: 'SUBMIT',
  };
}

/** The primary button's words, so the page and its tests agree on them. */
export function primaryActionLabel(action: Lifecycle['action']): string | null {
  switch (action) {
    case 'SUBMIT':
      return 'Send for review';
    case 'RESUBMIT':
      return 'Send updated version';
    case 'WITHDRAW':
      return 'Withdraw from review';
    default:
      return null;
  }
}
