import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { CONFIG_SEARCH_INDEX } from '../data/configSearchIndex';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

interface ConfigSearchOverlayProps {
  onClose: () => void;
  onNavigate: (target: string) => void;
}

/** Full-screen search overlay for the Configuration hub — plain client-side filter, no command-palette library needed for a list this small. */
export function ConfigSearchOverlay({ onClose, onNavigate }: ConfigSearchOverlayProps) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return CONFIG_SEARCH_INDEX.filter((entry) => `${entry.title} ${entry.module} ${entry.keywords}`.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-6 sm:px-6">
        <div className="flex flex-1 items-center gap-2.5 rounded-[13px] border-[1.5px] border-primary bg-card px-3.5 py-2.5">
          <Search className="h-3.5 w-3.5 flex-none text-primary" strokeWidth={1.6} />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings, actions…"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <button type="button" onClick={onClose} className="flex-none px-1 py-1 text-[13.5px] font-semibold text-primary">
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-6 sm:px-6">
        {!query.trim() && (
          <p className="pt-6 text-center text-[13px] text-muted-foreground">Type to search rent rules, late fees, hostel identity…</p>
        )}

        {query.trim() && results.length === 0 && (
          <div className="pt-12 text-center">
            <div className="font-display text-sm font-semibold text-foreground">No matches for &quot;{query}&quot;</div>
            <div className="mt-1 text-xs text-muted-foreground">Try &quot;late fee&quot; or &quot;hostel&quot;.</div>
          </div>
        )}

        {results.length > 0 && (
          <div className={card}>
            {results.map((entry, i) => (
              <ListRow
                key={entry.title}
                leading={
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-[9px] font-display text-[13px] font-bold"
                    style={{ background: entry.tint, color: entry.iconColor }}
                  >
                    {entry.glyph}
                  </span>
                }
                title={entry.title}
                meta={entry.module}
                showChevron
                onClick={() => onNavigate(entry.target)}
                className={`px-4 ${i === 0 ? '' : 'border-t border-border/60'}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
