import { EMPTY_CELL_LABEL, type WeekGrid, type WeekGridCell } from './weekGrid';

/**
 * Local, not-yet-sent cell edits for an already-PUBLISHED schedule (ADR-123).
 * A DRAFT schedule never uses this — its edits still PATCH immediately
 * (ADR-114), since a DRAFT row is already invisible to tenants regardless of
 * when it's saved. Keyed by `food_schedule_meals` row id, valued with the
 * cell's full new ordered `menu_item_id` list (the same shape `setCellItems`
 * always took).
 */
export type PendingEdits = Record<string, string[]>;

/** Whether a schedule's edits should buffer locally instead of PATCHing immediately. */
export function shouldBufferEdits(status: 'DRAFT' | 'PUBLISHED' | undefined): boolean {
  return status === 'PUBLISHED';
}

/** Records (or overwrites) one cell's pending target ids. */
export function setPendingEdit(pending: PendingEdits, mealId: string, menuItemIds: string[]): PendingEdits {
  return { ...pending, [mealId]: menuItemIds };
}

/** True once there is at least one buffered, not-yet-sent cell edit. */
export function hasPendingChanges(pending: PendingEdits): boolean {
  return Object.keys(pending).length > 0;
}

/** After a flush, keeps only the entries that failed to save — the ones that succeeded are cleared and reflect via the next refetch. */
export function clearFlushed(pending: PendingEdits, failedMealIds: string[]): PendingEdits {
  const failed = new Set(failedMealIds);
  const next: PendingEdits = {};
  for (const [mealId, ids] of Object.entries(pending)) {
    if (failed.has(mealId)) next[mealId] = ids;
  }
  return next;
}

/**
 * Overlays pending cell edits onto a server-committed `WeekGrid` for on-screen
 * display — what the owner sees updates immediately regardless of save state
 * (ADR-123). `item_name` on a pending item is left blank: every real consumer
 * resolves a placed item's display name via `resolveDisplayName(item,
 * liveNameById)`, keyed on `menu_item_id` (which a pending item always
 * carries, since it only ever came from `addItem`/an existing library pick)
 * — `item_name` is only a fallback for an orphaned/soft-deleted id, which a
 * just-added pending item can't be.
 */
export function applyPendingEdits(grid: WeekGrid, pending: PendingEdits): WeekGrid {
  if (Object.keys(pending).length === 0) return grid;
  return grid.map((cell): WeekGridCell => {
    if (!cell.id || !(cell.id in pending)) return cell;
    const items = pending[cell.id].map((id, index) => ({ id: `pending-${id}-${index}`, menu_item_id: id, item_name: '', display_order: index }));
    return {
      ...cell,
      items,
      menu_item_id: items[0]?.menu_item_id ?? null,
      item_name: items.length > 0 ? items.map((i) => i.item_name).join(', ') : EMPTY_CELL_LABEL,
    };
  });
}
