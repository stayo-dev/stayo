import { ChevronsUpDown } from 'lucide-react';
import { useSelectedHostel } from './useSelectedHostel';

/**
 * The owner desktop hostel context, rendered in `AppConsoleShell`'s
 * `contextSlot` — the pinned control directly under the wordmark
 * ([[Decisions#ADR-171|ADR-171]] §6, Phase 2.6).
 *
 * It reads and writes the **existing** `useSelectedHostel` state (URL
 * `?hostelId=` + a `localStorage` last-used fallback) — there is no separate
 * store. Global screens (Money, Tenants list, …) read `selectedHostelId` back
 * and re-scope in place; hostel-scoped screens live at `/owner/hostels/:hostelId`
 * and pin the context by their route param, in which case this renders
 * read-only.
 *
 * Shapes to the account, matching how the mobile Hostels tab collapses
 * (`hostelsTab.ts`):
 *  - 0 hostels  → nothing
 *  - 1 hostel   → the hostel name, static (a one-item picker is a tap on nothing)
 *  - pinned by route → the current hostel name, static
 *  - 2+ hostels → an "All hostels" + per-hostel `<select>`
 */
export function HostelSwitcher() {
  const { hostels, selectedHostel, selectedHostelId, selectHostel, pinnedByRoute, isLoading } = useSelectedHostel();

  if (isLoading || hostels.length === 0) return null;

  const staticName = (label: string) => (
    <div className="flex flex-col gap-0.5 rounded-[10px] bg-white/[.05] px-2.5 py-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[.13em] text-[var(--sidebar-foreground)]/45">Hostel</span>
      <span className="truncate text-[12.5px] font-semibold text-[var(--sidebar-foreground)]">{label}</span>
    </div>
  );

  if (hostels.length === 1) return staticName(hostels[0].name);
  if (pinnedByRoute) return staticName(selectedHostel?.name ?? 'This hostel');

  return (
    <label className="flex flex-col gap-0.5 rounded-[10px] bg-white/[.05] px-2.5 py-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[.13em] text-[var(--sidebar-foreground)]/45">Hostel</span>
      <div className="relative flex items-center">
        <select
          value={selectedHostelId ?? 'all'}
          onChange={(e) => selectHostel(e.target.value === 'all' ? null : e.target.value)}
          className="w-full cursor-pointer appearance-none bg-transparent pr-5 text-[12.5px] font-semibold text-[var(--sidebar-foreground)] focus:outline-none"
        >
          <option value="all" className="text-foreground">
            All hostels
          </option>
          {hostels.map((h) => (
            <option key={h.id} value={h.id} className="text-foreground">
              {h.name}
            </option>
          ))}
        </select>
        <ChevronsUpDown
          className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-[var(--sidebar-foreground)]/50"
          strokeWidth={2}
        />
      </div>
    </label>
  );
}
