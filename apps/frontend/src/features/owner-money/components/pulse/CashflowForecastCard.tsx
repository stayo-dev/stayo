interface ForecastDay {
  label: string;
  value: string;
  amount: number;
}

interface CashflowForecastCardProps {
  forecast: ForecastDay[];
}

/** 7-day cashflow forecast bar chart, per Stayo App.dc.html. */
export function CashflowForecastCard({ forecast }: CashflowForecastCardProps) {
  const max = Math.max(1, ...forecast.map((b) => b.amount));

  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[13.5px] font-bold text-foreground">Cashflow forecast</span>
        <span className="text-[11.5px] text-muted-foreground">last 7 days</span>
      </div>
      <div className="flex h-16 items-end gap-1.5 pt-0.5">
        {forecast.map((b) => (
          <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="whitespace-nowrap text-[9.5px] font-bold text-primary">{b.value}</span>
            <div className="w-full rounded-t-md bg-primary/70" style={{ height: `${Math.max(2, (b.amount / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {forecast.map((b) => (
          <span key={b.label} className="flex-1 text-center text-[9.5px] font-medium text-muted-foreground">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
