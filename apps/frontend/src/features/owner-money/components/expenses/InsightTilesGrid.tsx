import { useState } from 'react';
import type { MockExpense } from '@shared/mocks/expenses';

interface CategoryInsight {
  category: string;
  amount: number;
  percent: number;
}

interface VendorInsight {
  vendor: string;
  amount: number;
  payments: number;
}

interface AnomalyInsight {
  category: string;
  anomaly: string | null;
}

interface InsightTilesGridProps {
  topCategory: CategoryInsight | undefined;
  topVendor: VendorInsight | undefined;
  largestExpense: MockExpense | undefined;
  anomaly: AnomalyInsight | null;
}

/** 2x2 insight tiles — top category / unusual spending / top vendor / largest expense, per Stayo App.dc.html. */
export function InsightTilesGrid({ topCategory, topVendor, largestExpense, anomaly }: InsightTilesGridProps) {
  const [unusualOpen, setUnusualOpen] = useState(false);

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Top category</div>
        <div className="mt-0.5 font-display text-[13px] font-bold text-foreground">{topCategory?.category ?? '—'}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          ₹{(topCategory?.amount ?? 0).toLocaleString('en-IN')} · {topCategory?.percent ?? 0}%
        </div>
      </div>
      <button type="button" onClick={() => setUnusualOpen((v) => !v)} className="rounded-2xl border border-border bg-card p-3 text-left">
        <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Unusual spending</div>
        {anomaly ? (
          <>
            <div className="mt-0.5 font-display text-[13px] font-bold text-foreground">{anomaly.category}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Trending up vs last month</div>
            {unusualOpen && <div className="mt-1 border-t border-border pt-1 text-[10px] leading-relaxed text-muted-foreground">{anomaly.anomaly}</div>}
          </>
        ) : (
          <div className="mt-0.5 font-display text-[13px] font-bold text-foreground">Nothing unusual</div>
        )}
      </button>
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Top vendor</div>
        <div className="mt-0.5 font-display text-[13px] font-bold text-foreground">{topVendor?.vendor ?? '—'}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          ₹{(topVendor?.amount ?? 0).toLocaleString('en-IN')} · {topVendor?.payments ?? 0} payment{(topVendor?.payments ?? 0) === 1 ? '' : 's'}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Largest expense</div>
        <div className="mt-0.5 font-display text-[13px] font-bold text-foreground">{largestExpense?.title ?? '—'}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">₹{(largestExpense?.amount ?? 0).toLocaleString('en-IN')}</div>
      </div>
    </div>
  );
}
