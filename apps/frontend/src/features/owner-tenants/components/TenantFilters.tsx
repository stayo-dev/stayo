import { useState } from 'react';
import { Search, Check, ChevronDown } from 'lucide-react';
import type { useRealTenantList } from '../hooks/useRealTenantList';
import { DUES_BUCKETS, INVITE_STAGES, type SubFilter, type TenantView } from '../tenantListFilters';

interface TenantFiltersProps {
  filters: ReturnType<typeof useRealTenantList>;
  /**
   * Desktop (`lg+`, ADR-171 Phase 2.8): the hostel scope is the sidebar
   * `HostelSwitcher`, so this in-page hostel selector is hidden to avoid a
   * duplicate. Search + chips stay. Undefined/false below `lg` — the mobile
   * control is unchanged.
   */
  hideHostelSelector?: boolean;
}

const VIEWS: { id: TenantView; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unpaid', label: 'Overdue' },
  { id: 'invited', label: 'Invited' },
];

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Hostel selector + search + filter chips, per Stayo App.dc.html's Tenants tab. */
export function TenantFilters({ filters, hideHostelSelector }: TenantFiltersProps) {
  const [hostelOpen, setHostelOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {!hideHostelSelector && (
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
      )}

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
        {VIEWS.map((v) => {
          const active = filters.view === v.id;
          const count = filters.counts[v.id];
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={active}
              onClick={() => filters.setFilter(v.id)}
              className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-display text-xs font-semibold ${
                active ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
              }`}
            >
              {v.label} {count}
            </button>
          );
        })}
      </div>

      {filters.view === 'unpaid' && (
        <SubFilterRow
          label="How far behind"
          selected={filters.sub}
          onSelect={(sub) => filters.setFilter('unpaid', sub)}
          anyCount={filters.counts.unpaid}
          options={DUES_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: filters.counts.dues[b.id] }))}
          note={
            filters.counts.unpaid > 0
              ? `${filters.counts.unpaid} ${filters.counts.unpaid === 1 ? 'tenant owes' : 'tenants owe'} ${rupees(filters.counts.unpaidAmount)} past due · furthest behind first`
              : 'Nobody is behind on rent.'
          }
        />
      )}

      {filters.view === 'invited' && (
        <SubFilterRow
          label="Invitation stage"
          selected={filters.sub}
          onSelect={(sub) => filters.setFilter('invited', sub)}
          anyCount={filters.counts.invited}
          options={INVITE_STAGES.map((st) => ({ id: st.id, label: st.label, count: filters.counts.stages[st.id] }))}
          note={
            INVITE_STAGES.find((st) => st.id === filters.sub)?.hint ??
            (filters.counts.invited > 0 ? 'Grouped by where each tenant is stuck, the ones needing you first.' : 'No pending invitations.')
          }
        />
      )}
    </div>
  );
}

interface SubFilterRowProps {
  label: string;
  selected: SubFilter;
  onSelect: (sub: SubFilter) => void;
  anyCount: number;
  options: { id: SubFilter; label: string; count: number }[];
  note: string;
}

/**
 * The drill-down under a view. Empty buckets are hidden so the row only
 * offers choices that return someone, except the selected one, which stays
 * visible so it can be switched off.
 */
function SubFilterRow({ label, selected, onSelect, anyCount, options, note }: SubFilterRowProps) {
  const visible = options.filter((o) => o.count > 0 || o.id === selected);
  return (
    <div className="-mt-1 flex flex-col gap-2 rounded-[14px] border border-border bg-card/60 p-2.5">
      <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto">
        {[{ id: 'any' as SubFilter, label: 'All', count: anyCount }, ...visible].map((o) => {
          const active = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(o.id)}
              className={`flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[11.5px] font-semibold ${
                active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {o.label}
              <span className={`tabular-nums ${active ? 'text-primary' : 'text-foreground/70'}`}>{o.count}</span>
            </button>
          );
        })}
      </div>
      <p className="px-1 text-[11.5px] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}
