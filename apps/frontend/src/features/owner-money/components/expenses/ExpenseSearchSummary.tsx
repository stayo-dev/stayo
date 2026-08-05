import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp, Store } from 'lucide-react';
import { expenseService } from '@features/expenses/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { cn } from '@shared/lib/cn';

/**
 * Search answers the question before it shows the rows (module audit, §7B).
 *
 * Searching "Rice" previously just filtered an in-memory list of the current
 * month. It now leads with what the owner actually wants to know — how much,
 * how often, typical size, largest, most recent, main supplier, and the change
 * against the previous period — and only then the transactions.
 *
 * Every figure comes from `getExpenseTitleSummary`; this component computes
 * none of its own. It also searches the **whole history**, not just the rows
 * the screen happens to have loaded.
 */

const INR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn('font-display text-[14px] font-extrabold tabular-nums text-foreground', tone)}>{value}</span>
    </div>
  );
}

export function ExpenseSearchSummary({
  search,
  from,
  to,
}: {
  search: string;
  /** ISO dates for the active range, so the summary respects the filter. */
  from?: string;
  to?: string;
}) {
  const session = useOwnerSession();
  const q = search.trim();

  const query = useQuery({
    queryKey: ['owner', 'expense-title-summary', q, from ?? '', to ?? ''],
    queryFn: () => expenseService.getTitleSummary(q, from, to) as Promise<any>,
    enabled: session.isAuthenticated && q.length >= 2,
    staleTime: 60_000,
  });

  if (q.length < 2) return null;

  const data = query.data?.data ?? query.data;
  const s = data?.summary;

  if (query.isLoading) {
    return <div className="h-[104px] animate-pulse rounded-2xl bg-muted" />;
  }

  if (!s) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-[12.5px] text-muted-foreground">
          No expenses match “{q}” in your history.
        </p>
      </div>
    );
  }

  const change = s.change_percent as number | null;
  const up = typeof change === 'number' && change > 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] font-extrabold text-foreground">
            {INR(s.total_spent)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            across {s.total_transactions} purchase{s.total_transactions === 1 ? '' : 's'}
          </div>
        </div>
        {typeof change === 'number' && (
          <span
            className={cn(
              'flex flex-none items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-bold',
              up ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
            )}
          >
            {up ? <TrendingUp className="h-3 w-3" strokeWidth={2.5} /> : <TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
            {up ? '+' : ''}
            {change}% vs previous
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-3">
        <Fact label="Average" value={INR(s.average_purchase)} />
        <Fact label="Largest" value={INR(s.highest)} />
        <Fact
          label="Last"
          value={s.last_purchase_date ? INR(s.last_purchase_amount) : '—'}
        />
      </div>

      {s.top_vendor && (
        <div className="flex items-center gap-2 border-t border-border/60 pt-3">
          <Store className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
            Mostly from <b className="font-semibold">{s.top_vendor.name}</b>
          </span>
          <span className="flex-none text-[10.5px] tabular-nums text-muted-foreground">
            {s.top_vendor.purchases}× · {INR(s.top_vendor.total)}
          </span>
        </div>
      )}
    </div>
  );
}
