/**
 * Pure logic backing "Copy to days" (`MealPlanPage.tsx`'s `handleCopyToDays`,
 * via `CopyToDaysSheet.tsx`). Used to also host `findDropTarget`, the
 * multi-cell drop resolver for dragging a Food Library chip onto any cell
 * (ADR-121) — removed when the Food Library drawer was replaced by a
 * per-cell Add Food popover (ADR-123); that drag mechanism no longer exists.
 */

import type { DayKey } from './weekGrid';

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
