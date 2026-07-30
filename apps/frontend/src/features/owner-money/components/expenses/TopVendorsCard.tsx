interface TopVendorsCardProps {
  vendorTotals: { vendor: string; amount: number; payments: number }[];
}

/** Top vendors this month, derived from the real expenses endpoint's `vendor_breakdown`. */
export function TopVendorsCard({ vendorTotals }: TopVendorsCardProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <span className="font-display text-[13.5px] font-bold text-foreground">Top vendors this month</span>
      {vendorTotals.slice(0, 3).map((v) => (
        <div key={v.vendor} className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12.5px] font-semibold text-foreground">{v.vendor}</span>
            <span className="text-[10.5px] text-muted-foreground">
              {v.payments} payment{v.payments === 1 ? '' : 's'}
            </span>
          </div>
          <span className="font-display text-[13.5px] font-bold tabular-nums text-foreground">₹{v.amount.toLocaleString('en-IN')}</span>
        </div>
      ))}
    </div>
  );
}
