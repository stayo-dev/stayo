/**
 * Ordering rules for the owner Home "Property" list.
 *
 * Kept as pure functions (no React, no network) because the ordering is the
 * part that must not be got wrong: the components are thin renderers over
 * whatever these return. See ADR-042.
 */

export type HostelSortMode = 'custom' | 'dues' | 'occupancy' | 'revenue' | 'name';

/**
 * Labels are deliberately directional ("Most dues", not "Dues") — a bare
 * metric name doesn't tell the owner which end of the list they'll get, and
 * occupancy in particular sorts ascending (most vacant first) which is the
 * opposite of what "Occupancy" alone implies.
 */
export const HOSTEL_SORT_OPTIONS: { mode: HostelSortMode; label: string; short: string }[] = [
  { mode: 'custom', label: 'My order', short: 'My order' },
  { mode: 'dues', label: 'Most dues first', short: 'Most dues' },
  { mode: 'occupancy', label: 'Most vacant first', short: 'Most vacant' },
  { mode: 'revenue', label: 'Highest revenue first', short: 'Top revenue' },
  { mode: 'name', label: 'Name (A–Z)', short: 'Name' },
];

export interface SortableHostel {
  id: string;
  name: string;
  /** Server-persisted manual position. `null` = never reordered. */
  displayOrder: number | null;
  outstandingValue: number;
  revenueValue: number;
  occupancyPercent: number;
}

/** Only this mode allows manual drag — the others are computed. */
export function isReorderable(mode: HostelSortMode): boolean {
  return mode === 'custom';
}

function byName(a: SortableHostel, b: SortableHostel): number {
  return a.name.localeCompare(b.name);
}

/**
 * Mirrors the server's ordering exactly (`display_order` ASC NULLS LAST, then
 * name) so the list doesn't visibly reshuffle between the optimistic update
 * and the refetch.
 */
function byCustom(a: SortableHostel, b: SortableHostel): number {
  const ao = a.displayOrder;
  const bo = b.displayOrder;
  if (ao === null && bo === null) return byName(a, b);
  if (ao === null) return 1;
  if (bo === null) return -1;
  if (ao !== bo) return ao - bo;
  return byName(a, b);
}

const COMPARATORS: Record<HostelSortMode, (a: SortableHostel, b: SortableHostel) => number> = {
  custom: byCustom,
  // Ties fall back to name so the order is stable across renders rather than
  // depending on the order the API happened to return.
  dues: (a, b) => b.outstandingValue - a.outstandingValue || byName(a, b),
  revenue: (a, b) => b.revenueValue - a.revenueValue || byName(a, b),
  occupancy: (a, b) => a.occupancyPercent - b.occupancyPercent || byName(a, b),
  name: byName,
};

/** Returns a new array; never mutates the input. */
export function sortHostels<T extends SortableHostel>(list: T[], mode: HostelSortMode): T[] {
  return [...list].sort(COMPARATORS[mode]);
}

/**
 * Move the item at `from` to index `to`, clamping to the array bounds so a
 * "Move up" on the first row is a no-op rather than an error.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

export function canMoveUp(index: number): boolean {
  return index > 0;
}

export function canMoveDown(index: number, total: number): boolean {
  return index < total - 1;
}

/**
 * Occupancy pill colour.
 *
 * Previously hardcoded to `success`, so 75% and 88% rendered identically
 * green and the pill carried no signal at all — it was decoration shaped like
 * a status. Thresholds are deliberately coarse: the pill answers "does this
 * property need attention?", not "what exactly is the rate?" (the number is
 * right there).
 */
export function occupancyTone(percent: number): 'success' | 'warning' | 'destructive' {
  if (percent >= 85) return 'success';
  if (percent >= 60) return 'warning';
  return 'destructive';
}

const STORAGE_KEY = 'stayo:hostelSortMode';

/**
 * Sort mode is a per-device view preference, not owner data — the manual
 * *order* is what goes to the server. Persisting it locally just stops the
 * list resetting to "My order" on every visit.
 */
export function loadSortMode(): HostelSortMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && HOSTEL_SORT_OPTIONS.some((o) => o.mode === raw)) return raw as HostelSortMode;
  } catch {
    // Private mode / storage disabled — fall through to the default.
  }
  return 'custom';
}

export function saveSortMode(mode: HostelSortMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Non-fatal: the mode just won't survive a reload.
  }
}
