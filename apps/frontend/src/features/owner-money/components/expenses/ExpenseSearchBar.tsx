import { Search, SlidersHorizontal, Download } from 'lucide-react';

interface ExpenseSearchBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  onOpenFilters: () => void;
  onOpenExport: () => void;
}

/** Search + filter + export bar for the Expenses list, per Stayo App.dc.html. */
export function ExpenseSearchBar({ search, onSearchChange, onOpenFilters, onOpenExport }: ExpenseSearchBarProps) {
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
        aria-label="Filters"
        className="flex h-10.5 w-10.5 flex-none items-center justify-center rounded-[14px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
      >
        <SlidersHorizontal className="h-4 w-4 text-foreground/80" strokeWidth={1.8} />
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
