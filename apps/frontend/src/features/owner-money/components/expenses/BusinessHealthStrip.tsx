import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface BusinessHealthStripProps {
  netProfit: number;
  revenue: number;
}

/** "Business health" expandable strip atop Expenses, per Stayo App.dc.html. */
export function BusinessHealthStrip({ netProfit, revenue }: BusinessHealthStripProps) {
  const [open, setOpen] = useState(false);
  const marginPercent = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;
  const healthy = marginPercent >= 40;

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className={`rounded-2xl px-4 py-3.5 text-left ${healthy ? 'bg-success/15' : 'bg-[#F5F0E9]'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`font-display text-sm font-bold ${healthy ? 'text-success' : 'text-[#6B6259]'}`}>Business health</span>
        <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-display text-[11px] font-bold ${healthy ? 'bg-success/20 text-success' : 'bg-white/60 text-[#6B6259]'}`}>
          {healthy ? 'Healthy' : 'Watch'}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </div>
      {open && (
        <p className="mt-2 border-t border-current/10 pt-2 text-[11.5px] leading-relaxed opacity-85">
          {marginPercent}% net margin this month — net profit of ₹{netProfit.toLocaleString('en-IN')} on ₹{revenue.toLocaleString('en-IN')} revenue.
        </p>
      )}
    </button>
  );
}
