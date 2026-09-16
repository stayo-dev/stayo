import { ShieldCheck, X } from 'lucide-react';
import { guardianPromptCopy } from './guardianVerification';
import {
  useDismissGuardianWall,
  useGuardianVerification,
  useRequestGuardianConfirmation,
} from './useGuardianVerification';

/**
 * The insistent half (ADR-212): a sheet over the dashboard once a deferral has
 * run past the date the tenant was promised.
 *
 * ## What this is careful not to be
 *
 * It does not block entry. "Not now" is plain, present, at the bottom, and
 * works on the first tap — no timer, no greyed-out delay, no second
 * confirmation. Every one of those tricks would raise the conversion rate and
 * spend trust to do it, on a screen whose whole subject is asking a family to
 * trust us with a phone number.
 *
 * It also leads with what the *guardian* gains rather than what the hostel
 * wants. The hostel's interest here is real, but it is not the reader's, and a
 * demand phrased institutionally invites them to treat it as someone else's
 * problem. `guardianPromptCopy` owns that wording and is tested for it.
 *
 * How often it appears is decided server-side (`shouldShowGuardianWall`): the
 * first time it comes due, then every third entry. A prompt that cannot be
 * escaped stops being read.
 */
export function GuardianVerificationWall() {
  const { data } = useGuardianVerification();
  const request = useRequestGuardianConfirmation();
  const dismiss = useDismissGuardianWall();

  if (!data?.show_wall || dismiss.isSuccess) return null;

  const copy = guardianPromptCopy(data.state, data.guardian_name, data.deadline_at);
  if (!copy) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-[2px] sm:items-center">
      <div className="w-full max-w-[420px] rounded-t-[22px] border border-border bg-card p-6 pb-7 shadow-xl sm:rounded-[22px]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-warning/10 text-warning">
            <ShieldCheck className="h-5 w-5" strokeWidth={2} />
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dismiss.mutate()}
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-3.5 font-display text-[19px] font-extrabold tracking-[-0.015em] text-foreground">
          {copy.title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{copy.body}</p>

        <button
          type="button"
          disabled={request.isPending || request.isSuccess}
          onClick={() => request.mutate()}
          className="mt-5 w-full rounded-xl bg-primary py-3 font-display text-[14px] font-bold text-primary-foreground disabled:opacity-60"
        >
          {request.isSuccess ? 'Sent — waiting for them' : request.isPending ? 'Sending…' : copy.primaryAction}
        </button>

        {request.isSuccess && (
          <p className="mt-2.5 text-center text-[11.5px] text-muted-foreground">
            They just need to tap “Yes, I confirm” on WhatsApp.
          </p>
        )}

        {/* Always here, always one tap, never delayed. See the note above. */}
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          className="mt-3 w-full py-1.5 text-center text-[13px] font-semibold text-muted-foreground"
        >
          {copy.secondaryAction}
        </button>
      </div>
    </div>
  );
}
