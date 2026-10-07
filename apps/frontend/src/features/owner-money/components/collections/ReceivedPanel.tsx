import { useMemo, useState } from 'react';
import { ReceiptText, Search, X } from 'lucide-react';
import { ExportPill } from '../../export/ExportPill';
import type { ReceivedPanelState } from '../../hooks/useReceivedPanel';
import { ReceivedRow } from './ReceivedRow';
import {
  METHOD_OPTIONS,
  PERIOD_OPTIONS,
  emptyMessage,
  formatRupees,
  groupByDay,
  periodPhrase,
  summaryLine,
} from './received';

interface ReceivedPanelProps {
  state: ReceivedPanelState;
  onOpenExport: () => void;
  isDesktop: boolean;
}

/**
 * Collections → Received: who paid, newest first.
 *
 * Search and filters on top, the total for exactly what is listed, then the
 * payments grouped by the day they came in. A thin renderer — the wording is in
 * `received.ts` and the data in `useReceivedPanel`.
 */
export function ReceivedPanel({ state: s, onOpenExport, isDesktop }: ReceivedPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const days = useMemo(() => groupByDay(s.payments), [s.payments]);

  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs focus-within:border-primary">
        <Search className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={s.search}
          onChange={(e) => s.setSearch(e.target.value)}
          placeholder="Search tenant"
          aria-label="Search tenant"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {s.search && (
          <button type="button" onClick={() => s.setSearch('')} aria-label="Clear search" className="flex-none text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </label>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {PERIOD_OPTIONS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => s.setPeriod(p.id)}
            className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-display text-xs font-semibold ${
              s.period === p.id ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {METHOD_OPTIONS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => s.setMethod(m.id)}
            className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
              s.method === m.id ? 'bg-secondary text-primary' : 'border border-border bg-card text-muted-foreground'
            }`}
          >
            {m.label}
          </button>
        ))}
        <span className="ml-auto flex-none pl-1.5">
          <ExportPill onClick={onOpenExport} />
        </span>
      </div>

      {/* The total for exactly the rows below — every filter included. */}
      <div className="flex items-end justify-between gap-3 rounded-2xl border border-success/25 bg-success/[0.07] px-4 py-3">
        <div className="min-w-0">
          <div className="font-display text-[22px] font-extrabold leading-tight tabular-nums text-success">
            {s.summary ? formatRupees(s.summary.total) : '—'}
          </div>
          <div className="text-[11.5px] font-semibold text-muted-foreground">received {periodPhrase(s.period)}</div>
        </div>
        <div className="flex-none text-right text-[11.5px] font-semibold text-muted-foreground">
          {s.summary ? summaryLine(s.summary) : ''}
          {s.isFetching && !s.isLoading && !s.isLoadingMore && <span className="block text-[10.5px]">Updating…</span>}
        </div>
      </div>

      {s.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : s.isError ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm text-muted-foreground">Couldn't load payments.</p>
          <button type="button" onClick={() => s.refetch()} className="rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground">
            Try again
          </button>
        </div>
      ) : days.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ReceiptText className="h-7 w-7 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-muted-foreground">{emptyMessage(s.period, s.isFiltered)}</p>
          {!s.isFiltered && s.period !== 'all' && (
            <button type="button" onClick={() => s.setPeriod('all')} className="text-xs font-bold text-primary">
              See all time
            </button>
          )}
        </div>
      ) : (
        <div className={isDesktop ? 'grid items-start gap-3 lg:grid-cols-2' : 'flex flex-col gap-3'}>
          {days.map((d) => (
            <section key={d.day} aria-label={d.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between px-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{d.label}</span>
                <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{formatRupees(d.total)}</span>
              </div>
              <div className="rounded-2xl border border-border bg-card px-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
                {d.payments.map((p) => (
                  <ReceivedRow
                    key={p.id}
                    payment={p}
                    showHostel={s.spansHostels}
                    open={openId === p.id}
                    onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {s.hasMore && !s.isLoading && (
        <button
          type="button"
          onClick={() => s.loadMore()}
          disabled={s.isLoadingMore}
          className="self-center rounded-full border border-border bg-card px-5 py-2 text-xs font-bold text-foreground disabled:opacity-60"
        >
          {s.isLoadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
