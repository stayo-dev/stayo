import { AlertTriangle, Check, X } from 'lucide-react';
import type { DocumentDiff } from './agreementDiff';
import { blastRadiusLabel, type PublishReadiness } from './agreementWorkspace';

/**
 * What publishing will do, before it does it.
 *
 * Publishing used to be one tap with no diff, no blast radius and no check on
 * unknown tokens. An owner could reword a notice period and have no way to see
 * what they had altered, nor who would sign it.
 */
export function PublishReviewSheet({
  diff,
  readiness,
  affectedTenants,
  publishing,
  onCancel,
  onConfirm,
}: {
  diff: DocumentDiff;
  readiness: PublishReadiness;
  affectedTenants: number | null;
  publishing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const group = (label: string, titles: string[]) =>
    titles.length > 0 && (
      <div className="mt-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label} · {titles.length}
        </div>
        <ul className="mt-1.5 flex flex-col gap-1">
          {titles.map((t) => (
            <li key={t} className="text-[12.5px] text-foreground/85">{t}</li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-[22px] bg-card px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:max-w-[520px] sm:rounded-[22px] sm:pb-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[16px] font-extrabold text-foreground">Publish this version?</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {blastRadiusLabel(affectedTenants)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border text-muted-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {readiness.blockers.map((b) => (
          <p key={b} className="mt-3 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[12px] leading-[1.5] text-destructive">
            {b}
          </p>
        ))}

        {readiness.warnings.map((w) => (
          <p
            key={w}
            className="mt-3 flex items-start gap-2 rounded-xl bg-[color:var(--warning)]/12 px-3.5 py-2.5 text-[12px] leading-[1.5] text-[color:var(--warning)]"
          >
            <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" strokeWidth={2.2} />
            {w}
          </p>
        ))}

        {group('Added', diff.added)}
        {group('Reworded', diff.changed)}
        {group('Removed', diff.removed)}

        {diff.unchanged > 0 && (
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            {diff.unchanged} section{diff.unchanged === 1 ? '' : 's'} unchanged.
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[13px] border border-border px-4 py-3 text-[13.5px] font-semibold text-foreground"
          >
            Keep editing
          </button>
          <button
            type="button"
            disabled={!readiness.canPublish || publishing}
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-primary py-3 text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {!publishing && <Check className="h-4 w-4" strokeWidth={2.4} />}
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
