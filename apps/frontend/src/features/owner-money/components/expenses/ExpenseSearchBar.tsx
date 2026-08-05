import { Search, SlidersHorizontal, Download } from 'lucide-react';

interface ExpenseSearchBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  onOpenFilters: () => void;
  onOpenExport: () => void;
  /**
   * How many filters are narrowing the list. Shown as a badge so the owner
   * can tell *why* they're seeing three rows without opening the sheet —
   * previously applied filters were completely invisible from here.
   */
  activeFilterCount?: number;
}

/** Search + filter + export bar for the Expenses list, per Stayo App.dc.html. */
export function ExpenseSearchBar({
  search,
  onSearchChange,
  onOpenFilters,
  onOpenExport,
  activeFilterCount = 0,
}: ExpenseSearchBarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-border bg-card px-3.5 py-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.6} />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search title, vendor, category, amount…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onOpenFilters}
        aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
        className={`relative flex h-10.5 w-10.5 flex-none items-center justify-center rounded-[14px] border shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)] ${
          activeFilterCount > 0 ? 'border-primary bg-secondary/50' : 'border-border bg-card'
        }`}
      >
        <SlidersHorizontal
          className={`h-4 w-4 ${activeFilterCount > 0 ? 'text-primary' : 'text-foreground/80'}`}
          strokeWidth={1.8}
        />
        {activeFilterCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background bg-primary px-1 font-display text-[9px] font-bold text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onOpenExport}
        className="flex h-10.5 flex-none items-center gap-1.5 rounded-[14px] border border-border bg-card px-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
      >
        <Download className="h-3.5 w-3.5 text-foreground/80" strokeWidth={1.8} />
        <span className="font-display text-[12.5px] font-bold text-foreground">Export</span>
      </button>
    </div>
  );
}
