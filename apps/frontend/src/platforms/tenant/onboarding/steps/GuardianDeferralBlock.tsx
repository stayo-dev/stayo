import { useState } from 'react';
import {
  GUARDIAN_DEFERRAL_REASONS,
  guardianDeferralAcknowledgement,
  type GuardianDeferralReason,
} from '@features/guardian-verification/guardianVerification';

/**
 * The way past guardian verification when the guardian cannot be reached
 * (ADR-212) — and, deliberately, the *third* thing offered on this part of the
 * screen.
 *
 * ## Why this is a link and not a button
 *
 * Before ADR-212 there was no way past at all: a tenant at the reception desk
 * whose parent was asleep, travelling or simply not answering could not finish
 * onboarding, and the hostel's real remedy was to send them away and try again
 * another day.
 *
 * Opening that door carries an obvious risk — that everybody walks through it.
 * The answer is not to hide the door, which would just recreate the old
 * problem with extra steps, but to order the options honestly: ask the guardian
 * (one tap for them, nothing to relay), enter the code (works when they are
 * sitting together), and only then this. Visual weight follows that order.
 * Someone who needs this finds it; someone who does not is never invited to
 * take it.
 *
 * ## Why it asks a question
 *
 * Skipping costs exactly one tap, and that tap is "what's in the way?". Naming
 * an obstacle is a small act of ownership, and it is the only way the hostel
 * ever learns the one thing reminders cannot fix — that this parent has no
 * WhatsApp, which a phone call solves in a minute.
 *
 * ## Why it names a date
 *
 * An open-ended "we'll remind you" leaves an unbounded obligation hanging over
 * someone. A date turns it into a diary entry they can stop carrying. It is
 * also simply what will happen, which is the better reason of the two.
 */
export function GuardianDeferralBlock({
  guardianName,
  chased,
  deadline,
  reason,
  onReasonChange,
}: {
  guardianName: string | null | undefined;
  /** False in an OPTIONAL hostel, where nothing is promised because nothing is chased. */
  chased: boolean;
  /** The date we will ask again, known before anything is saved. */
  deadline: Date | null;
  reason: GuardianDeferralReason | null;
  onReasonChange: (reason: GuardianDeferralReason | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const who = String(guardianName || '').trim() || 'your guardian';

  if (reason) {
    return (
      <div className="mt-2.5 rounded-[10px] border px-3 py-2.5" style={{ borderColor: '#E7DDCE', background: '#FAF6F0' }}>
        <div className="text-[12px] font-bold" style={{ color: '#3A342E' }}>
          {guardianDeferralAcknowledgement(deadline, chased)}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: '#8A7F75' }}>
          You can finish signing up now. {who}&apos;s number stays on your record marked “Not verified”
          until they confirm.
        </p>
        <button
          type="button"
          onClick={() => {
            onReasonChange(null);
            setOpen(false);
          }}
          className="mt-1.5 text-[11px] font-semibold"
          style={{ color: '#B46A55' }}
        >
          Actually, let me verify now
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-[11.5px] font-semibold underline underline-offset-2"
        style={{ color: '#8A7F75' }}
      >
        {who} can&apos;t confirm right now
      </button>
    );
  }

  return (
    <div className="mt-2.5 rounded-[10px] border px-3 py-2.5" style={{ borderColor: '#E7DDCE' }}>
      <div className="text-[12px] font-bold" style={{ color: '#3A342E' }}>
        What&apos;s in the way?
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {GUARDIAN_DEFERRAL_REASONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onReasonChange(option.value)}
            className="rounded-[9px] border px-3 py-2 text-left text-[12px] font-semibold"
            style={{ borderColor: '#E7DDCE', color: '#3A342E' }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-2 text-[11px] font-semibold"
        style={{ color: '#8A7F75' }}
      >
        Never mind
      </button>
    </div>
  );
}
