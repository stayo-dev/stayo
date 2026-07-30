const BAR_COLORS = ['bg-primary', 'bg-[#E08E4E]', 'bg-[#9C82C9]', 'bg-info', 'bg-success'];

interface ExpenseBreakdownCardProps {
  categoryBreakdown: { category: string; amount: number; percent: number }[];
  totalExpenses: number;
}

/** Monthly expense breakdown — per-category progress bars, derived from the real expenses endpoint's `category_breakdown`. */
export function ExpenseBreakdownCard({ categoryBreakdown, totalExpenses }: ExpenseBreakdownCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <span className="font-display text-[13.5px] font-bold text-foreground">Monthly expense breakdown</span>
      {categoryBreakdown.map((row, i) => (
        <div key={row.category} className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-semibold text-foreground">
            <span>{row.category}</span>
            <span className="tabular-nums">₹{row.amount.toLocaleString('en-IN')}</span>
          </div>
          <div className="h-[7px] overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`} style={{ width: `${row.percent}%` }} />
          </div>
          <div className="text-[10.5px] text-muted-foreground">{row.percent}% of expenses</div>
        </div>
      ))}
      <div className="flex justify-between border-t border-border pt-2.5 font-display text-[13.5px] font-bold text-foreground">
        <span>Total</span>
        <span className="tabular-nums">₹{totalExpenses.toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
}
