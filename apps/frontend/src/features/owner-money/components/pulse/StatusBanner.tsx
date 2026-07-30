import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface StatusBannerProps {
  collectionRatePercent: number;
  netCashFlow: string;
  perTenant: string;
}

/** Expandable status banner atop Money → Overview, per Stayo App.dc.html. */
export function StatusBanner({ collectionRatePercent, netCashFlow, perTenant }: StatusBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const healthy = collectionRatePercent >= 50;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className={`rounded-2xl px-4 py-3.5 text-left ${healthy ? 'bg-success/15 text-success' : 'bg-[#FBE4E1] text-[#8A2E1F]'}`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span className="font-display text-sm font-bold">
          {healthy ? 'Collections are on track' : `Only ${collectionRatePercent}% collected this month`}
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 opacity-75" /> : <ChevronDown className="h-3.5 w-3.5 opacity-75" />}
      </div>
      {expanded && (
        <div className="mt-2.5 flex flex-col gap-1.5 border-t border-current/10 pt-2.5">
          <div className="flex justify-between text-xs font-medium">
            <span>Net cash flow</span>
            <span className="font-bold tabular-nums">{netCashFlow}</span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span>Per tenant</span>
            <span className="font-bold tabular-nums">{perTenant}</span>
          </div>
          <div className="flex justify-between text-xs font-medium">
            <span>Collection rate</span>
            <span className="font-bold tabular-nums">{collectionRatePercent}%</span>
          </div>
        </div>
      )}
    </button>
  );
}
