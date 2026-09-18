import { ChevronRight, ShieldCheck } from 'lucide-react';
import { guardianPromptCopy, formatGuardianDeadline } from './guardianVerification';
import {
  useGuardianVerification,
  useRequestGuardianConfirmation,
} from './useGuardianVerification';

const card =
  'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';

/**
 * The quiet half of the guardian nudge (ADR-212) — a card on the Dashboard's
 * Home tab, sitting in the same family as `ProfileCompletionNudge`.
 *
 * Placement is the argument. Presented among the other "finish setting up"
 * items rather than as a warning of its own, verification reads as the last
 * thing left in a nearly-complete set — which is both true and the framing
 * people actually act on. A standalone alert would say the same words and
 * invite the reader to treat it as somebody else's problem.
 *
 * Renders nothing at all unless this hostel chases the gap. In an OPTIONAL
 * hostel the badge on the profile is the whole of it; putting a card here
 * anyway would be the product overruling the owner's setting.
 */
export function GuardianVerificationCard() {
  const { data, isLoading } = useGuardianVerification();
  const request = useRequestGuardianConfirmation();

  if (isLoading || !data || !data.chased) return null;
  if (data.state === 'VERIFIED' || data.state === 'NOT_APPLICABLE') return null;

  const copy = guardianPromptCopy(data.state, data.guardian_name, data.deadline_at);
  if (!copy) return null;

  const by = formatGuardianDeadline(data.deadline_at);

  return (
    <div className={`${card} p-[18px]`}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-warning/10 text-warning">
          <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14.5px] font-extrabold tracking-[-0.01em] text-foreground">
            {copy.title}
          </div>
          <p className="mt-1 text-[12px] font-medium leading-relaxed text-muted-foreground">{copy.body}</p>
        </div>
      </div>

      <button
        type="button"
        disabled={request.isPending || request.isSuccess}
        onClick={() => request.mutate(undefined)}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-primary py-2.5 font-display text-[13px] font-bold text-primary-foreground disabled:opacity-60"
      >
        {request.isSuccess ? 'Sent — waiting for them' : request.isPending ? 'Sending…' : copy.primaryAction}
        {!request.isSuccess && !request.isPending && <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {request.isSuccess && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          They just need to tap “Yes, I confirm” on WhatsApp.
        </p>
      )}
      {!request.isSuccess && by && data.state === 'PENDING_GRACE' && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">We’ll ask again on {by}.</p>
      )}
    </div>
  );
}
