import { ExportPill } from '../../export/ExportPill';

export type CollectionsSort = 'Most overdue' | 'Highest amount' | 'Name';

const SORT_OPTIONS: CollectionsSort[] = ['Most overdue', 'Highest amount', 'Name'];

interface CollectionsFiltersProps {
  hostels: { id: string; name: string }[];
  hostelFilter: string;
  onHostelFilterChange: (id: string) => void;
  sort: CollectionsSort;
  onSortChange: (sort: CollectionsSort) => void;
  /**
   * Desktop (`lg+`, ADR-171 Phase 2.6): the hostel scope is owned by the sidebar
   * `HostelSwitcher`, so the per-hostel chip row here is hidden to avoid a
   * duplicate control. The sort chips stay. Undefined/false below `lg` — the
   * mobile control is unchanged.
   */
  hideHostelFilter?: boolean;
  /** Exports this tab's data — what came in, and who still owes. */
  onOpenExport: () => void;
}

/** Hostel filter chips + sort chips for the Collections list, per Stayo App.dc.html. */
export function CollectionsFilters({ hostels, hostelFilter, onHostelFilterChange, sort, onSortChange, hideHostelFilter, onOpenExport }: CollectionsFiltersProps) {
  return (
    <div className="flex flex-col gap-2">
      {!hideHostelFilter && (
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
      )}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
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
        <span className="ml-auto flex-none pl-1.5">
          <ExportPill onClick={onOpenExport} />
        </span>
      </div>
    </div>
  );
}
