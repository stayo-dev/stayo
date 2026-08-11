import { ArrowRight, Link2Off } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { StayoLoader } from '@shared/ui/brand';
import type { TermChange } from './invitationWorkspace';

/**
 * The single confirmation before anything is sent.
 *
 * Saving an edited invitation rotates the activation token server-side, so the
 * tenant's existing link stops working the moment this is confirmed. That
 * consequence is stated here rather than buried in a modal subtitle, and every
 * change is named — an owner is never asked to approve "some changes".
 */
export function ReviewChangesSheet({
  open,
  onClose,
  changes,
  isSending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  changes: TermChange[];
  isSending: boolean;
  onConfirm: () => void;
}) {
  const termsChanged = changes.some((change) => change.isFinancial);

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && onClose()} title="Send updated invitation">
      <div className="flex flex-col gap-4">
        <p className="-mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {termsChanged
            ? 'These are the terms the tenant will see. They have not registered yet, so nothing is billed by this change.'
            : 'These details will be corrected on the invitation.'}
        </p>

        <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border">
          {changes.map((change) => (
            <div key={change.field} className="flex items-center gap-2 px-3.5 py-3">
              <span className="w-[38%] shrink-0 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                {change.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground line-through">
                {change.from}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" strokeWidth={2.2} />
              <span className="min-w-0 flex-1 truncate text-right font-display text-[13.5px] font-extrabold text-foreground">
                {change.to}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2.5 rounded-2xl bg-warning/10 p-3.5">
          <Link2Off className="mt-0.5 h-4 w-4 flex-none text-warning" strokeWidth={2} />
          <p className="text-[12px] leading-relaxed text-foreground">
            The tenant's current link will stop working. A fresh link is sent to them on WhatsApp.
          </p>
        </div>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="min-h-[48px] flex-1 rounded-xl border border-border bg-card font-display text-[14px] font-bold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSending}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary font-display text-[14px] font-bold text-primary-foreground shadow-sm disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            {isSending ? (
              <>
                <StayoLoader size="sm" label={null} /> Sending…
              </>
            ) : (
              'Send updated invitation'
            )}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
