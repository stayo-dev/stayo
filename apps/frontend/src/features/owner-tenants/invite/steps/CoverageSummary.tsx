import type { PreviewDisplay } from '../settlementPreview';

interface CoverageSummaryProps {
  display: PreviewDisplay;
}

const row = 'flex items-baseline justify-between gap-2 text-[12.5px]';

/**
 * Where the rent part of an already-paid amount went: months covered, the
 * month rent is paid through, what is due now, and what is prepaid. Rendered
 * by both the Money step (while typing) and the Verify step (before Send).
 * A thin renderer over `buildPreviewDisplay` — every figure comes from the
 * backend's own settlement plan.
 */
export function CoverageSummary({ display }: CoverageSummaryProps) {
  const coverage = display.coverage;
  if (!coverage || display.overpaidAmount > 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-muted/50 px-3 py-2.5">
      <div className={row}>
        <span className="text-muted-foreground">Rent covered</span>
        <span className="font-bold tabular-nums text-foreground">
          {coverage.monthsCovered} month{coverage.monthsCovered === 1 ? '' : 's'}
        </span>
      </div>
      {coverage.paidThroughLabel && (
        <div className={row}>
          <span className="text-muted-foreground">Rent paid through</span>
          <span className="font-bold text-foreground">{coverage.paidThroughLabel}</span>
        </div>
      )}
      {coverage.futureRentCovered > 0 && (
        <div className={row}>
          <span className="text-muted-foreground">Future rent covered</span>
          <span className="font-bold tabular-nums text-foreground">₹{coverage.futureRentCovered.toLocaleString('en-IN')}</span>
        </div>
      )}
      <div className={row}>
        <span className="text-muted-foreground">Due now</span>
        <span className={`font-bold tabular-nums ${display.remainingOutstanding > 0 ? 'text-warning' : 'text-success'}`}>
          ₹{display.remainingOutstanding.toLocaleString('en-IN')}
        </span>
      </div>
      {coverage.nextDueLabel && (
        <div className={row}>
          <span className="text-muted-foreground">Next rent due</span>
          <span className="font-bold text-foreground">{coverage.nextDueLabel}</span>
        </div>
      )}
      {coverage.partialNote && (
        <p className="border-t border-border/60 pt-1.5 text-[11.5px] leading-[1.5] text-muted-foreground">{coverage.partialNote}</p>
      )}
    </div>
  );
}
