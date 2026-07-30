export type CollectionsSort = 'Most overdue' | 'Highest amount' | 'Name';

const SORT_OPTIONS: CollectionsSort[] = ['Most overdue', 'Highest amount', 'Name'];

interface CollectionsFiltersProps {
  hostels: { id: string; name: string }[];
  hostelFilter: string;
  onHostelFilterChange: (id: string) => void;
  sort: CollectionsSort;
  onSortChange: (sort: CollectionsSort) => void;
}

/** Hostel filter chips + sort chips for the Collections list, per Stayo App.dc.html. */
export function CollectionsFilters({ hostels, hostelFilter, onHostelFilterChange, sort, onSortChange }: CollectionsFiltersProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {hostels.map((h) => {
          const active = hostelFilter === h.id;
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onHostelFilterChange(h.id)}
              className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-display text-xs font-semibold ${
                active ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
              }`}
            >
              {h.name}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {SORT_OPTIONS.map((s) => {
          const active = sort === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSortChange(s)}
              className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                active ? 'bg-secondary text-primary' : 'border border-border bg-card text-muted-foreground'
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
