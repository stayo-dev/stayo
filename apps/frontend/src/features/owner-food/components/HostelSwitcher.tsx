import { ChevronDown } from 'lucide-react';
import type { OwnerSessionHostel } from '@features/owner-session/types';

interface HostelSwitcherProps {
  hostels: OwnerSessionHostel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Renders nothing for a single-hostel owner — zero friction where there is no
 * choice to make. For everyone else it is mandatory: this screen previously
 * read `hostels[0]` with no way to reach any other property's food.
 */
export function HostelSwitcher({ hostels, selectedId, onSelect }: HostelSwitcherProps) {
  if (hostels.length < 2) return null;

  return (
    <div className="relative">
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Choose hostel"
        className="min-h-[44px] appearance-none rounded-xl border border-border bg-card py-2.5 pl-3.5 pr-9 text-[12.5px] font-semibold text-foreground outline-none focus:border-primary"
      >
        {hostels.map((h) => (
          <option key={h.id} value={h.id}>{h.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
