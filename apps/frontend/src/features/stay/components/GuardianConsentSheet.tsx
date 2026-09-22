import { guardianConsentCopy } from '../stayState';

interface GuardianConsentSheetProps {
  guardianName: string | null;
  busy: boolean;
  onDecide: (granted: boolean) => void;
}

/**
 * Asked once, after the return date is picked on the tenant's first leave.
 * Two buttons, no default, no third option — a consent question with a
 * pre-selected answer is not a consent question. See ADR-233.
 */
export function GuardianConsentSheet({ guardianName, busy, onDecide }: GuardianConsentSheetProps) {
  const copy = guardianConsentCopy(guardianName);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6">
        <p className="font-display text-xl font-extrabold tracking-tight text-foreground">{copy.title}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{copy.body}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(true)}
          className="mt-6 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-60"
        >
          {copy.accept}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide(false)}
          className="mt-2 h-12 w-full rounded-xl border border-border bg-card font-semibold text-foreground disabled:opacity-60"
        >
          {copy.decline}
        </button>
      </div>
    </div>
  );
}
