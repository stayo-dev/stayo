import { useState } from 'react';
import { Search, Check, ChevronDown } from 'lucide-react';
import type { useRealTenantList } from '../hooks/useRealTenantList';

interface TenantFiltersProps {
  filters: ReturnType<typeof useRealTenantList>;
}

const CHIPS: { id: 'all' | 'overdue' | 'invited'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'invited', label: 'Invited' },
];

/** Hostel selector + search + filter chips, per Stayo App.dc.html's Tenants tab. */
export function TenantFilters({ filters }: TenantFiltersProps) {
  const [hostelOpen, setHostelOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <button
          type="button"
          onClick={() => setHostelOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-[11px] border border-border bg-card px-3 py-2.5 text-left"
        >
          <span className="flex-none font-display text-xs font-bold text-muted-foreground">H</span>
          <span className="min-w-0 flex-1 truncate font-display text-[13px] font-bold text-foreground">{filters.selectedHostelName}</span>
          <ChevronDown className={`h-3.5 w-3.5 flex-none text-muted-foreground transition-transform ${hostelOpen ? 'rotate-180' : ''}`} />
        </button>
        {hostelOpen && (
          <div className="absolute inset-x-0 top-full z-10 mt-1.5 overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_10px_26px_rgba(42,37,33,0.16)]">
            {filters.hostelOptions.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  filters.setHostelId(h.id);
                  setHostelOpen(false);
                }}
                className="flex w-full items-center gap-2.5 border-b border-border/60 px-3.5 py-3 text-left last:border-none"
              >
                <span className="min-w-0 flex-1 truncate font-display text-[13px] font-bold text-foreground">{h.name}</span>
                {filters.hostelId === h.id && <Check className="h-3.5 w-3.5 flex-none text-primary" strokeWidth={3} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-[14px] py-[11px] shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
        <input
          value={filters.search}
          onChange={(e) => filters.setSearch(e.target.value)}
          placeholder="Search tenant, room, phone…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {CHIPS.map((c) => {
          const active = filters.chip === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => filters.setChip(c.id)}
              className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-display text-xs font-semibold ${
                active ? 'bg-foreground text-background' : 'border border-[#EAE1D8] bg-card text-[#6B6259]'
              }`}
            >
              {c.label} {filters.counts[c.id]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
