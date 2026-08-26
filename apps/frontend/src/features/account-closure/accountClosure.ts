/**
 * Leaving Stayo — the decision logic behind closing an account.
 *
 * ## On making this hard
 *
 * The brief was to make someone "think a second time before leaving the Stayo
 * family". There is an honest way to do that and a dishonest one, and they
 * look similar from a spec.
 *
 * The dishonest version hides the button, buries it under settings that do not
 * exist, adds steps that carry no information, or refuses outright. That is
 * obstruction. It does not change anyone's mind — it converts someone who
 * wanted to leave into someone who wanted to leave *and* resents us — and
 * under India's DPDP Act the right to erasure is not ours to withhold.
 *
 * The honest version is what is built here: **friction made of information**.
 * Every step someone passes through tells them something they did not know —
 * what specifically they lose, what happens to money still moving, that the
 * thing annoying them has a smaller fix. If they read all of it and still
 * mean it, they leave in three taps and we ask why. That is the same shape as
 * the move-out ceremony (`moveOut.ts`), on purpose: leaving a hostel and
 * leaving Stayo should not feel like they were designed by different people.
 *
 * The one hard stop is a live tenancy, and it is not a retention device — an
 * account is what a hostel bills, so deleting it mid-stay would break someone
 * else's books, not just the leaver's.
 *
 * PURE — no React, no network.
 */

export type ClosureBlockerKind = 'LIVE_TENANCY' | 'OUTSTANDING_DUES' | 'PENDING_MOVE_OUT';

export interface ClosureBlocker {
  kind: ClosureBlockerKind;
  title: string;
  body: string;
  action?: { label: string; to: string };
}

export interface ClosureContext {
  hasLiveTenancy: boolean;
  outstandingPaise: number;
  moveOutPending: boolean;
  hostelName?: string | null;
}

/**
 * What stands between someone and closing their account — at most one thing,
 * because a list of three obstacles reads as a wall rather than a next step.
 *
 * Ordered by what they must do first: settle, then leave the hostel, then
 * close. Telling someone to move out when they owe rent would just send them
 * back here.
 */
export function closureBlocker(context: ClosureContext): ClosureBlocker | null {
  if (context.outstandingPaise > 0) {
    return {
      kind: 'OUTSTANDING_DUES',
      title: 'There is rent still owing',
      body: 'Your account is what your hostel bills against, so it has to stay open until the balance is settled. Once it is clear, closing takes a minute.',
      action: { label: 'See what is due', to: '/tenant/money' },
    };
  }
  if (context.moveOutPending) {
    return {
      kind: 'PENDING_MOVE_OUT',
      title: 'Your move-out is still being settled',
      body: 'Your hostel is working through the final settlement. Closing now would leave that half-finished — give it until they confirm.',
      action: { label: 'Check your room', to: '/tenant/room' },
    };
  }
  if (context.hasLiveTenancy) {
    return {
      kind: 'LIVE_TENANCY',
      title: `You still live at ${context.hostelName ?? 'your hostel'}`,
      body: 'Move out first and let the settlement finish. That protects your deposit and leaves your hostel with a clean record — closing the account now would strand both.',
      action: { label: 'Request to move out', to: '/tenant/room' },
    };
  }
  return null;
}

export interface LossItem {
  label: string;
  detail: string;
}

/**
 * What actually goes, stated in the person's own numbers.
 *
 * Generic warnings ("all your data will be deleted") are ignored because they
 * are true of every account everywhere. "Four months of stay history, which
 * is what future hostels read as a reference" is a fact about *them*, and it
 * is the only kind of sentence that changes a decision.
 *
 * Anything they have none of is left out — warning someone about losing zero
 * saved hostels spends their attention and teaches them we are padding.
 */
export function whatYouLose(input: {
  stays: number;
  months: number;
  savedHostels: number;
  documents: number;
  enquiries: number;
}): LossItem[] {
  const items: LossItem[] = [];

  if (input.stays > 0) {
    const stayText = input.stays === 1 ? '1 stay' : `${input.stays} stays`;
    const monthText = input.months > 0 ? `${input.months} month${input.months === 1 ? '' : 's'} of living somewhere` : 'your record of living somewhere';
    items.push({
      label: 'Your stay history',
      detail: `${stayText} — ${monthText}. It is what a future hostel reads as a reference, and it cannot be rebuilt.`,
    });
  }
  if (input.documents > 0) {
    items.push({
      label: 'Your document vault',
      detail: `${input.documents} verified document${input.documents === 1 ? '' : 's'}. You would upload and re-verify each one at the next hostel.`,
    });
  }
  if (input.savedHostels > 0) {
    items.push({
      label: 'Saved hostels',
      detail: `${input.savedHostels} place${input.savedHostels === 1 ? '' : 's'} you shortlisted.`,
    });
  }
  if (input.enquiries > 0) {
    items.push({
      label: 'Your enquiries',
      detail: `${input.enquiries} conversation${input.enquiries === 1 ? '' : 's'} with hostels, and any replies still coming.`,
    });
  }

  items.push({
    label: 'This email and phone',
    detail: 'They are freed up, so you could start again later — but as a new account, with none of the above.',
  });

  return items;
}

export interface ClosureReason {
  id: string;
  label: string;
}

/** Why people actually go. "Other" last, and always present. */
export const CLOSURE_REASONS: ClosureReason[] = [
  { id: 'FOUND_ELSEWHERE', label: 'I found a place another way' },
  { id: 'MOVED_HOME', label: 'I have moved home or out of the city' },
  { id: 'TOO_MANY_MESSAGES', label: 'Too many messages and notifications' },
  { id: 'PRIVACY', label: "I don't want my details stored" },
  { id: 'HARD_TO_USE', label: 'The app was hard to use' },
  { id: 'BAD_EXPERIENCE', label: 'A bad experience with a hostel' },
  { id: 'NOT_USEFUL', label: "I don't need Stayo any more" },
  { id: 'OTHER', label: 'Something else' },
];

export interface RetentionOffer {
  title: string;
  body: string;
  /** What we can actually do about it — never a plea to stay. */
  action?: { label: string; to: string };
}

/**
 * The smaller fix, offered once, only where one honestly exists.
 *
 * `null` for every reason we cannot help with — someone who has moved home is
 * not going to be argued out of it, and pretending otherwise is the exact
 * behaviour that makes a cancellation flow feel like a trap. Roughly half the
 * reasons return nothing, which is what keeps the other half credible.
 */
export function retentionOffer(reasonId: string): RetentionOffer | null {
  switch (reasonId) {
    case 'TOO_MANY_MESSAGES':
      return {
        title: 'You can just turn the messages off',
        body: 'Closing the account is a large fix for a small problem. Tell us what to stop and we will stop it — your history stays where it is.',
        action: { label: 'Tell Stayo what to stop', to: '/profile/tickets' },
      };
    case 'HARD_TO_USE':
      return {
        title: 'Tell us what got in the way',
        body: 'If something was confusing or broken, that is ours to fix, and a real person reads every report. We would rather change the app than lose you.',
        action: { label: 'Report the problem', to: '/profile/tickets' },
      };
    case 'BAD_EXPERIENCE':
      return {
        title: "That shouldn't have happened",
        body: 'A bad hostel is a problem with our listing, not just your stay. Tell us which one and what happened — it affects who we let list with us.',
        action: { label: 'Tell Stayo about it', to: '/profile/tickets' },
      };
    case 'PRIVACY':
      return {
        title: 'You choose who sees your record',
        body: 'Your stay history is private by default — each hostel only sees it if you allow it. If that is the worry, it may already be handled.',
        action: { label: 'See who can see what', to: '/profile/history' },
      };
    case 'NOT_USEFUL':
      return {
        title: 'An account left alone costs you nothing',
        body: 'There is no fee and no obligation to keep it. If you might look for a place again, leaving it dormant keeps your history and documents ready.',
      };
    // Found a place elsewhere, moved home, or something else — nothing honest
    // to offer, so nothing is offered.
    default:
      return null;
  }
}

/** The phrase someone types to confirm. Short enough to type, specific enough to mean it. */
export const CONFIRM_PHRASE = 'DELETE';

export function confirmPhraseMatches(typed: string): boolean {
  return String(typed ?? '').trim().toUpperCase() === CONFIRM_PHRASE;
}

export interface ClosureFeedback {
  reason: string;
  note: string;
}

/**
 * Whether we can close the account.
 *
 * A reason is required; the free-text note is not. Forcing someone to write
 * prose on the way out is how you get "asdf" and learn nothing — the reason
 * chip is the datum worth having, and the note is where the ones who care
 * will say more.
 */
export function canClose(feedback: ClosureFeedback, typed: string): boolean {
  return Boolean(feedback.reason) && confirmPhraseMatches(typed);
}

/**
 * What we keep afterwards, stated plainly to the person leaving.
 *
 * Payment and agreement records survive because a hostel's books and a signed
 * agreement are not solely the leaver's to erase, and saying so up front is
 * better than being discovered later. Everything that identifies them goes.
 */
export const RETAINED_NOTICE = {
  title: 'What we have to keep',
  body: 'Payment and agreement records stay with the hostels you stayed at — their books and your signed agreements are not ours alone to erase. Your name, phone, email, documents and photos are removed, and nothing left behind points back at you.',
} as const;
