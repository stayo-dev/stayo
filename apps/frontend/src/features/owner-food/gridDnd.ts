/**
 * Pure logic for the Meal Plan grid's multi-zone drag/drop — every one of the
 * 28 (7 day × 4 meal) cells is a live drop zone simultaneously, unlike the
 * single "active section" model `timetableDnd.ts` was written for. See
 * ADR-121.
 */

import type { MealSlotKey } from '@shared/mocks/food';
import type { Rect } from './timetableDnd';
import { isOverDropZone } from './timetableDnd';
import type { DayKey } from './weekGrid';

export interface GridCellKey {
  day: DayKey;
  slot: MealSlotKey;
}

export interface GridCellRect extends GridCellKey {
  rect: Rect;
}

/**
 * Which of many simultaneously-live cells (if any) a drop point landed on.
 * Reuses `isOverDropZone`'s point-in-rect test unchanged — the "one active
 * zone" framing lived only in `timetableDnd.ts`'s call sites, never in that
 * function's own logic. Returns `null` for a drop outside every cell (empty
 * page) rather than guessing a default target.
 */
export function findDropTarget(point: { x: number; y: number }, cells: GridCellRect[]): GridCellKey | null {
  for (const cell of cells) {
    if (isOverDropZone(point, cell.rect)) return { day: cell.day, slot: cell.slot };
  }
  return null;
}

/**
 * "Copy to days" — given a source cell's ordered items and the target days
 * chosen (same meal type on each), returns the per-day PATCH payloads the
 * caller sends via the existing `setCellItems` primitive. Composed from the
 * existing single-cell write path rather than a new bulk endpoint (ADR-121).
 * A `menu_item_id: null` item (an orphaned/soft-deleted reference) can't be
 * copied forward as a real selection, so it's dropped rather than copied.
 */
export function planCopyToDays(
  sourceItems: { menu_item_id: string | null }[],
  targetDays: DayKey[],
): { day: DayKey; ids: string[] }[] {
  const ids = sourceItems.map((i) => i.menu_item_id).filter((id): id is string => Boolean(id));
  return targetDays.map((day) => ({ day, ids }));
}
