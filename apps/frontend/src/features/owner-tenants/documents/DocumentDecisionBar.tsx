import { Check, X } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';

/**
 * Approve or reject one document — the same two buttons wherever the owner is
 * looking at it (the review queue, the tenant profile's preview sheet), so the
 * decision cannot mean one thing in one place and another elsewhere.
 *
 * Reject sits on the left and Approve on the right, where the thumb rests on a
 * phone: the common action is the easy reach, the destructive one is a
 * deliberate stretch. Both are full-height tap targets.
 */

interface DocumentDecisionBarProps {
  onApprove: () => void;
  onReject: () => void;
  /** True while either decision for this document is in flight. */
  busy?: boolean;
  /** Which button shows the spinner. */
  pending?: 'approve' | 'reject' | null;
}

export function DocumentDecisionBar({ onApprove, onReject, busy = false, pending = null }: DocumentDecisionBarProps) {
  return (
    <div className="flex gap-2.5">
      <button
        type="button"
        onClick={onReject}
        disabled={busy}
        className="flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-card font-display text-[14px] font-bold text-destructive disabled:opacity-50"
      >
        {pending === 'reject' ? <StayoLoader size="sm" label={null} /> : <X className="h-4 w-4" strokeWidth={2.4} />}
        Reject
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="flex min-h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-success font-display text-[14px] font-bold text-white disabled:opacity-50"
      >
        {pending === 'approve' ? <StayoLoader size="sm" label={null} /> : <Check className="h-4 w-4" strokeWidth={2.6} />}
        Approve
      </button>
    </div>
  );
}
