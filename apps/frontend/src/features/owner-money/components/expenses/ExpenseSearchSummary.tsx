import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp, Store, Building2 } from 'lucide-react';
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

  // Vendors need the same treatment as products — searching "BESCOM" or "Sri
  // Rice Traders" must summarise the supplier relationship, not return
  // nothing because it isn't an expense *title*. The memory endpoint already
  // returns vendor-keyed aggregates, so this is presentation, not new
  // computation.
  const vendorQuery = useQuery({
    queryKey: ['owner', 'expense-memory', q],
    queryFn: () => expenseService.getMemory(q, 5) as Promise<any>,
    enabled: session.isAuthenticated && q.length >= 2,
    staleTime: 60_000,
  });

  const vendors = ((vendorQuery.data?.entries ?? []) as any[]).filter((e) => e.kind === 'VENDOR');

  if (q.length < 2) return null;

  const data = query.data?.data ?? query.data;
  const s = data?.summary;

  if (query.isLoading || vendorQuery.isLoading) {
    return <div className="h-[104px] animate-pulse rounded-2xl bg-muted" />;
  }

  // A vendor match with no title match is the "BESCOM" case: the supplier is
  // real, the word just never appears in an expense title.
  if (!s && vendors.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-[12.5px] text-muted-foreground">
          No expenses match “{q}” in your history.
        </p>
      </div>
    );
  }

  // `s` is null on a vendor-only match (the "BESCOM" case), so this must be
  // optional — the response is typed `any`, so nothing else would catch it.
  const change = (s?.change_percent ?? null) as number | null;
  const up = typeof change === 'number' && change > 0;

  return (
    <div className="flex flex-col gap-2.5">
      {s && (
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
      )}

      {vendors.map((v) => (
        <div key={v.key} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5 flex-none text-primary" strokeWidth={2} />
                <span className="truncate font-display text-[14px] font-extrabold text-foreground">{v.key}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {INR(v.totalSpent)} across {v.occurrences} payment{v.occurrences === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-3">
            <Fact label="Average" value={INR(v.averageAmount)} />
            <Fact label="Largest" value={INR(v.highestAmount)} />
            <Fact label="Last paid" value={INR(v.lastAmount)} />
          </div>

          {(v.hostelCount > 0 || v.category) && (
            <div className="flex items-center gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
              {v.hostelCount > 0 && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3 flex-none" strokeWidth={2} />
                  Supplies {v.hostelCount} propert{v.hostelCount === 1 ? 'y' : 'ies'}
                </span>
              )}
              {v.category && <span className="truncate">· {v.category}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
