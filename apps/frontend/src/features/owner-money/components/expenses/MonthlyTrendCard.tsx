interface MonthTrendRow {
  monthShort: string;
  total: number;
}

interface MonthlyTrendCardProps {
  trend: MonthTrendRow[];
}

function short(amount: number) {
  return amount >= 100000 ? `₹${(amount / 100000).toFixed(1)}L` : `₹${Math.round(amount / 1000)}K`;
}

/** 6-month expense trend bar chart, per Stayo App.dc.html. */
export function MonthlyTrendCard({ trend }: MonthlyTrendCardProps) {
  const max = Math.max(1, ...trend.map((m) => m.total));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Monthly trend</span>
      <div className="flex h-13 items-end gap-2">
        {trend.map((m) => (
          <div key={m.monthShort} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="whitespace-nowrap text-[9px] font-bold text-primary">{short(m.total)}</span>
            <div className="w-full rounded-t-md bg-primary/70" style={{ height: `${Math.max(2, (m.total / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {trend.map((m) => (
          <span key={m.monthShort} className="flex-1 text-center text-[9.5px] font-medium text-muted-foreground">
            {m.monthShort}
          </span>
        ))}
      </div>
    </div>
  );
}
