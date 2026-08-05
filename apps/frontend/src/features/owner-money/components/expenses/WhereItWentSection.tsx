import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@shared/lib/cn';

/**
 * One collapsed home for "where did the money go", replacing four cards that
 * each restated the other (module audit §5).
 *
 * The Expenses tab previously rendered ten blocks before the expense list —
 * net profit twice, top category in two places, top vendor in two places.
 * An owner opening this tab wants to add an expense or find one; everything
 * analytical belongs behind a tap, not above the content.
 *
 * Deliberately not a new card *alongside* the old ones: `BusinessHealthStrip`,
 * `InsightTilesGrid`, `ExpenseBreakdownCard` and `TopVendorsCard` all collapse
 * into this, so the count goes down rather than up.
 */

const INR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3.5 text-left"
      >
        <span className="flex-1 font-display text-[13.5px] font-bold text-foreground">{title}</span>
        {summary && <span className="text-[11px] tabular-nums text-muted-foreground">{summary}</span>}
        {open ? (
          <ChevronUp className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={2} />
        )}
      </button>
      {open && <div className="border-t border-border/60 p-4">{children}</div>}
    </div>
  );
}

function Bar({ label, amount, total, count }: { label: string; amount: number; total: number; count?: number }) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="min-w-0 truncate text-foreground">{label}</span>
        <span className="flex-none tabular-nums text-muted-foreground">
          {INR(amount)}
          {count != null && ` · ${count}×`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function WhereItWentSection({
  totalExpenses,
  categoryBreakdown,
  vendorTotals,
  largestExpense,
  anomalyCategory,
  monthlyTrend,
}: {
  totalExpenses: number;
  categoryBreakdown: Array<{ category: string; amount: number; count?: number }>;
  vendorTotals: Array<{ vendor: string; amount: number; count?: number }>;
  largestExpense?: { title?: string; amount?: number } | null;
  anomalyCategory?: { category?: string; changePercent?: number } | null;
  /** Matches `RealMonthTrend` from `useRealMoney` — short month label + total. */
  monthlyTrend?: Array<{ monthShort: string; total: number }>;
}) {
  const topCategory = categoryBreakdown?.[0];
  const topVendor = vendorTotals?.[0];

  const summaryBits = [
    topCategory ? `${topCategory.category} leads` : null,
    `${categoryBreakdown?.length ?? 0} categories`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-2">
      <Disclosure title="Where it went" summary={summaryBits}>
        <div className="flex flex-col gap-4">
          {categoryBreakdown?.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">By category</span>
              {categoryBreakdown.slice(0, 6).map((c) => (
                <Bar key={c.category} label={c.category} amount={c.amount} total={totalExpenses} count={c.count} />
              ))}
            </div>
          )}

          {vendorTotals?.length > 0 && (
            <div className="flex flex-col gap-2.5 border-t border-border/60 pt-4">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">By vendor</span>
              {vendorTotals.slice(0, 5).map((v) => (
                <Bar key={v.vendor} label={v.vendor} amount={v.amount} total={totalExpenses} count={v.count} />
              ))}
            </div>
          )}

          {(largestExpense?.amount || anomalyCategory?.category) && (
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-4 text-[11.5px] text-muted-foreground">
              {largestExpense?.amount ? (
                <span>
                  Largest single expense: <b className="font-semibold text-foreground">{largestExpense.title ?? '—'}</b>{' '}
                  {INR(largestExpense.amount)}
                </span>
              ) : null}
              {anomalyCategory?.category ? (
                <span>
                  Unusual spending in <b className="font-semibold text-foreground">{anomalyCategory.category}</b>
                  {typeof anomalyCategory.changePercent === 'number'
                    ? ` (${anomalyCategory.changePercent > 0 ? '+' : ''}${anomalyCategory.changePercent}%)`
                    : ''}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </Disclosure>

      {monthlyTrend && monthlyTrend.length > 0 && (
        <Disclosure title="Trend" summary={`${monthlyTrend.length} months`}>
          <div className="flex items-end gap-1.5" style={{ height: 96 }}>
            {monthlyTrend.map((m, i) => {
              const max = Math.max(...monthlyTrend.map((x) => x.total), 1);
              const h = Math.max(Math.round((m.total / max) * 80), 2);
              return (
                <div key={`${m.monthShort}-${i}`} className="flex flex-1 flex-col items-center gap-1">
                  <div className={cn('w-full rounded-t bg-primary/60')} style={{ height: h }} />
                  <span className="text-[9px] text-muted-foreground">{m.monthShort}</span>
                </div>
              );
            })}
          </div>
        </Disclosure>
      )}
    </div>
  );
}
