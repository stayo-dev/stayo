/**
 * Pure logic for the Meal Plan page's drag/tap interaction — no DOM, no
 * React. Per-cell operations only (add/remove/reorder/search/display-name
 * within one cell's own ids array). Used to also back "which of many
 * simultaneously-live cells did a Food Library chip land on" via `gridDnd.ts`'s
 * `findDropTarget` — retired along with the Food Library drawer (ADR-123);
 * `isOverDropZone` here is now reused instead for `resolveChipDrop`'s trash
 * zone check, a single fixed target rather than many cell rects.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether a page-coordinate point falls inside the active section's drop-zone rect. */
export function isOverDropZone(point: { x: number; y: number }, zoneRect: Rect): boolean {
  return point.x >= zoneRect.left && point.x <= zoneRect.right && point.y >= zoneRect.top && point.y <= zoneRect.bottom;
}

/**
 * Adds `itemId` to a cell's ordered id list — the one place the "no duplicate
 * food in the same meal slot" rule is enforced, so drag-add and tap-add can't
 * drift apart. A duplicate is a no-op, reported via `added: false` so the
 * caller can show "Already added" instead of pretending nothing happened.
 * The same item is still free to appear in a *different* cell (a different
 * day, or a different meal type) — this function only ever sees one cell's
 * ids at a time, so that's automatic, not a rule this function enforces.
 */
export function addItem(currentIds: string[], itemId: string): { ids: string[]; added: boolean } {
  if (currentIds.includes(itemId)) return { ids: currentIds, added: false };
  return { ids: [...currentIds, itemId], added: true };
}

/** Removes `itemId` from a cell's ordered id list — backs the × button. A missing id is a no-op. */
export function removeItem(currentIds: string[], itemId: string): string[] {
  return currentIds.filter((id) => id !== itemId);
}

/**
 * Given sibling chip rects (page coords, in current display order) and the
 * point where a drag ended, returns the 0-based index the dragged chip
 * should occupy. Out-of-range points clamp to the nearest end; a point over
 * the chip's own current slot returns that same index (no-op reorder).
 */
export function reorderIndexAt(point: { x: number; y: number }, siblingRects: Rect[], draggedIndex: number): number {
  if (siblingRects.length === 0) return draggedIndex;
  if (point.y <= siblingRects[0].top) return 0;
  for (let i = 0; i < siblingRects.length; i++) {
    if (point.y <= siblingRects[i].bottom) return i;
  }
  return siblingRects.length - 1;
}

/**
 * Where a placed chip's drag-end point resolves to — the trash zone (delete)
 * or an in-cell reorder slot. Trash is checked first and wins outright: a
 * chip dropped anywhere over the trash zone is removed, never reordered,
 * even if it also happens to overlap a sibling rect (backs
 * `MealPlanCell.handleReorderEnd`'s short-circuit, ADR-123). `trashRect` is
 * `null` when the trash zone hasn't mounted/measured yet, in which case this
 * always falls through to a reorder.
 */
export type ChipDropResolution = { kind: 'trash' } | { kind: 'reorder'; toIndex: number };

export function resolveChipDrop(
  point: { x: number; y: number },
  trashRect: Rect | null,
  siblingRects: Rect[],
  draggedIndex: number,
): ChipDropResolution {
  if (trashRect && isOverDropZone(point, trashRect)) return { kind: 'trash' };
  return { kind: 'reorder', toIndex: reorderIndexAt(point, siblingRects, draggedIndex) };
}

/** Moves the item at `fromIndex` to `toIndex`, returning the new ordered id array — the exact payload the PATCH endpoint needs. */
export function moveItem(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= ids.length) return ids;
  const clampedTo = Math.max(0, Math.min(toIndex, ids.length - 1));
  const next = ids.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/** Case-insensitive substring filter over a library slot's items — backs the search box. The caller is responsible for only passing items already scoped to the active meal type. */
export function filterByName<T extends { name: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}

/**
 * Prefers the food item's *current* Food Library name over the stored
 * snapshot on the schedule cell — a rename should show up on the Timetable
 * without duplicating the item. Falls back to the stored snapshot when the
 * item has no `menu_item_id` (never linked) or isn't found in the live map
 * (soft-deleted, or otherwise no longer active) — see ADR-114.
 */
export function resolveDisplayName(
  item: { menu_item_id: string | null; item_name: string },
  liveNameById: Map<string, string>,
): string {
  if (item.menu_item_id) {
    const liveName = liveNameById.get(item.menu_item_id);
    if (liveName) return liveName;
  }
  return item.item_name;
}
