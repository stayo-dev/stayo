import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { formatInr, monthRows, monthReconciles, type MonthBlock as MonthBlockData } from '../../payouts/payoutState';

/**
 * The block an owner checks against his own notebook.
 *
 * Indentation is doing real work here: "reached your bank" and "with Stayo" are
 * shown as parts OF "paid through Stayo", not as siblings, so the eye reads a
 * reconciliation rather than five unrelated stats. That is the difference
 * between a screen he verifies and one he has to believe.
 */
export function MonthBlock({ month }: { month: MonthBlockData }) {
  const navigate = useNavigate();
  const rows = monthRows(month);
  const reconciles = monthReconciles(month);

  return (
    <div className="rounded-2xl border border-border bg-card px-3.5 py-3">
      {rows.map((row) => {
        const isTotal = row.depth === 0;
        return (
          <div
            key={row.key}
            className={`flex items-baseline gap-2 ${isTotal ? 'pb-2' : 'py-[5px]'} ${
              isTotal ? 'border-b border-border/60' : ''
            }`}
            style={{ paddingLeft: `${row.depth * 14}px` }}
          >
            {row.depth > 0 && (
              <span aria-hidden className="-ml-2.5 select-none text-[11px] leading-none text-border">
                └
              </span>
            )}
            <span
              className={
                isTotal
                  ? 'flex-1 font-display text-[13px] font-extrabold text-foreground'
                  : 'flex-1 text-[12px] text-muted-foreground'
              }
            >
              {row.label}
              {row.hint && (
                <span className="ml-1.5 text-[10.5px] text-muted-foreground/70">({row.hint})</span>
              )}
            </span>
            <span
              className={`flex-none tabular-nums ${
                isTotal
                  ? 'font-display text-[15px] font-extrabold text-foreground'
                  : 'text-[12.5px] font-semibold text-foreground'
              }`}
            >
              {formatInr(row.amount)}
            </span>
          </div>
        );
      })}

      {/* Closes the loop back to the dues list below, so the owner can move
          between "what is owed" and "where it went" without a mental jump. */}
      <button
        type="button"
        onClick={() => navigate('/owner/money/collect')}
        className="mt-2 flex w-full items-center gap-2 border-t border-border/60 pt-2.5 text-left"
      >
        <span className="flex-1 text-[12px] font-semibold text-foreground">Still to collect</span>
        <span className="flex-none font-display text-[13px] font-bold tabular-nums text-destructive">
          {formatInr(month.stillToCollect)}
        </span>
        <span className="flex-none text-[11px] text-muted-foreground">
          {month.tenantsOwing} tenant{month.tenantsOwing === 1 ? '' : 's'}
        </span>
        <ChevronRight className="h-3.5 w-3.5 flex-none text-muted-foreground" />
      </button>

      {/* If the arithmetic ever stops working, say so rather than showing a
          block that quietly does not add up. Silence here would be the worst
          possible failure on the one screen built to be checkable. */}
      {!reconciles && (
        <p className="mt-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[10.5px] text-warning">
          These figures don't add up right now. We're looking into it — nothing has moved.
        </p>
      )}
    </div>
  );
}
