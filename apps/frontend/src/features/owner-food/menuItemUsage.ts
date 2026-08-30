import type { WeekGrid } from './weekGrid';

/**
 * How much of the current month's plan a library item is holding up.
 *
 * Removing a dish from the hostel's list is a **soft** delete on the backend
 * (`is_active = false`); the rows in `food_schedule_meals` that reference it
 * survive, so meals already planned with it keep it and past months are
 * untouched. That is the right behaviour and also completely invisible — an
 * owner looking at a confirmation dialog has no way to know it, and will
 * reasonably assume they are about to blank four cells of their week.
 *
 * So the confirmation says the number out loud. See ADR-145.
 */

/** Cells in the current week's grid that hold this item. */
export function countItemUsage(grid: WeekGrid, itemId: string): number {
  if (!itemId) return 0;
  let count = 0;
  for (const cell of grid ?? []) {
    if ((cell.items ?? []).some((item) => item.menu_item_id === itemId)) count += 1;
  }
  return count;
}

/**
 * What to tell the owner before they remove it, or null when the dish is not
 * in this month's plan and there is nothing extra to say.
 */
export function describeItemUsage(count: number): string | null {
  if (count <= 0) return null;
  const meals = count === 1 ? '1 meal' : `${count} meals`;
  return `It is in ${meals} this month. Those stay exactly as they are — this only takes it out of your list.`;
}
