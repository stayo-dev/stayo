import { AlertTriangle, ArrowRight, CheckCircle2, Users } from 'lucide-react';
import type { ReviewQueue } from '../reviewQueue';
import { attentionSummary, controlFor, groupAction } from '../issueCopy';

interface ReviewStepProps {
  queue: ReviewQueue;
  rooms: { to_create: number; to_update: number; unchanged: number } | null;
  onAcknowledgeGroup: (code: string) => void;
  onImport: () => void;
  busy: boolean;
}

/**
 * What needs the owner's attention, and nothing else.
 *
 * The rows that are fine collapse to a single line — an owner importing forty
 * residents should read "38 ready", not scroll past thirty-eight cards to find
 * the two that matter. Repeated problems are offered as one decision, because
 * a hostel running three years hits the same notice on nearly every row.
 *
 * One layout, two shapes: a card queue on a phone, the same cards in a grid
 * from `lg`. No separate desktop table to keep in sync.
 */
export function ReviewStep({ queue, rooms, onAcknowledgeGroup, onImport, busy }: ReviewStepProps) {
  const { summary, groups, needsYou, duplicates } = queue;
  const blocked = summary.blockers > 0;
  // Everything that is not blocked imports — a row whose only issue is a
  // decision goes in too, so counting just the untouched ones understated it
  // and could read "Import 0 tenants" on a button that worked.
  const importable =
    summary.ready + needsYou.filter((row) => !row.issues.some((i) => i.severity === 'BLOCKER')).length;

  return (
    <div className="space-y-4">
      <p className="font-display text-sm font-bold text-foreground">{attentionSummary(summary)}</p>

      {rooms && (rooms.to_create > 0 || rooms.to_update > 0) && (
        <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-[12.5px] font-medium text-muted-foreground">
          Your sheet also adds{' '}
          <span className="font-bold text-foreground">
            {rooms.to_create.toLocaleString('en-IN')} {rooms.to_create === 1 ? 'room' : 'rooms'}
          </span>
          {rooms.to_update > 0 && (
            <>
              {' '}and updates{' '}
              <span className="font-bold text-foreground">{rooms.to_update.toLocaleString('en-IN')}</span>
            </>
          )}
          . They&apos;re created first, before any tenant.
        </p>
      )}

      {/* One decision for a repeated problem, before the row-by-row list. */}
      {groups.filter((g) => g.canApplyToAll).map((group) => {
        const action = groupAction(group)!;
        return (
          <div key={group.code} className="rounded-xl border border-border bg-card p-3.5">
            <p className="font-display text-[13.5px] font-bold text-foreground">
              {group.count.toLocaleString('en-IN')} rows · {group.title}
            </p>
            <p className="mt-1 text-[12.5px] font-medium text-muted-foreground">{group.detail}</p>
            <button
              type="button"
              onClick={() => onAcknowledgeGroup(group.code)}
              className="mt-3 w-full rounded-xl border border-border py-2.5 font-display text-[13px] font-bold text-foreground"
            >
              {action.label}
            </button>
            <p className="mt-1.5 text-[11.5px] font-medium text-muted-foreground">{action.note}</p>
          </div>
        );
      })}

      {needsYou.length > 0 && (
        <ul className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {needsYou.map((row) => (
            <li key={row.row} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-display text-[13.5px] font-bold text-foreground">
                  {String(row.data.name || 'This row')}
                </p>
                <span className="flex-none text-[11.5px] font-semibold text-muted-foreground">
                  Row {row.row}
                </span>
              </div>

              {row.issues.map((issue) => {
                const control = controlFor(issue);
                return (
                  <div key={`${issue.code}-${issue.row}`} className="mt-2.5 border-t border-border pt-2.5 first:mt-2 first:border-0 first:pt-0">
                    <p className="flex items-start gap-1.5 text-[12.5px] font-bold text-foreground">
                      <AlertTriangle
                        className={`mt-0.5 h-3.5 w-3.5 flex-none ${
                          issue.severity === 'BLOCKER' ? 'text-destructive' : 'text-muted-foreground'
                        }`}
                      />
                      {issue.title}
                    </p>
                    <p className="mt-1 pl-5 text-[12px] font-medium text-muted-foreground">{issue.detail}</p>
                    {control.kind === 'acknowledge' && (
                      <button
                        type="button"
                        onClick={() => onAcknowledgeGroup(issue.code)}
                        className="mt-2 ml-5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-bold text-foreground"
                      >
                        {control.label}
                      </button>
                    )}
                    {control.options.length > 0 && (
                      <p className="mt-1.5 pl-5 text-[11.5px] font-semibold text-muted-foreground">
                        Nearest: {control.options.join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      )}

      {duplicates.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-3.5">
          <p className="flex items-center gap-1.5 font-display text-[13px] font-bold text-foreground">
            <Users className="h-3.5 w-3.5" />
            {duplicates.length.toLocaleString('en-IN')} already on Stayo
          </p>
          <p className="mt-1 text-[12.5px] font-medium text-muted-foreground">
            These people already have a live tenancy with you, so they won&apos;t be imported again.
          </p>
        </div>
      )}

      {summary.ready > 0 && needsYou.length === 0 && (
        <p className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-semibold text-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Everything checks out.
        </p>
      )}

      <button
        type="button"
        onClick={onImport}
        disabled={!summary.canImport || busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        {busy
          ? 'Importing…'
          : `Import ${importable.toLocaleString('en-IN')} ${importable === 1 ? 'tenant' : 'tenants'}`}
        {!busy && <ArrowRight className="h-4 w-4" />}
      </button>

      {blocked && (
        <p className="text-center text-[12px] font-medium text-muted-foreground">
          Fix the {summary.blockers.toLocaleString('en-IN')} {summary.blockers === 1 ? 'row' : 'rows'} above in your
          sheet, then upload it again.
        </p>
      )}
      <p className="text-center text-[12px] font-medium text-muted-foreground">
        Nothing is created until you tap Import — and your tenants aren&apos;t messaged until the step after that.
      </p>
    </div>
  );
}
