/**
 * Arranging the building (ADR-206) — every decision it makes.
 *
 * "Arrange" used to swap the building for a flat list of cards, and that list
 * ran ground-floor-first while the building runs top-floor-first, so entering
 * the mode turned the hostel upside down. Arrange is now the same building,
 * drawn by the same `stackFloors`, with the floors and rooms picked up and put
 * down in place.
 *
 * This module is the part with the rules in it: where a dragged thing lands,
 * what a keyboard move does, and how a screen order becomes the ascending
 * `sort_order` the API persists. The components only draw and listen.
 *
 * PURE — no React, no DOM; runs under the node-only vitest setup, which is
 * why the geometry arrives as plain rectangles rather than elements.
 */

/** A laid-out tile, as far as arranging is concerned. Screen coordinates. */
export interface TileBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

const centre = (box: TileBox) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

/**
 * Move one item of `order` from `from` to `to`, both as indices into the list
 * as it currently reads. Out-of-range indices leave the list alone rather than
 * throw — a drag released outside the floor is a no-op, not an error.
 */
export function moveItem<T>(order: T[], from: number, to: number): T[] {
  if (from === to) return order;
  if (from < 0 || from >= order.length) return order;
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Where a tile dragged to (`x`, `y`) should land among `boxes`.
 *
 * Rooms sit in a grid that wraps, so there is no single axis to compare along
 * — the answer is the tile whose centre the pointer is nearest, which is what
 * the eye is doing anyway. `boxes` is every tile on the floor *including* the
 * one being dragged, in their resting positions; the dragged tile is skipped
 * so a small movement doesn't count as landing on itself.
 *
 * Returns the index the dragged tile should occupy, or `draggedIndex` when
 * there is nowhere better to go.
 */
export function dropIndex(boxes: TileBox[], draggedIndex: number, x: number, y: number): number {
  if (draggedIndex < 0 || draggedIndex >= boxes.length) return draggedIndex;

  let best = draggedIndex;
  let bestDistance = Infinity;

  for (let i = 0; i < boxes.length; i += 1) {
    if (i === draggedIndex) continue;
    const c = centre(boxes[i]!);
    const distance = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  if (best === draggedIndex) return draggedIndex;

  // Only take a neighbour's place once the pointer is actually inside its
  // half — otherwise a tile jitters between two slots while the finger sits
  // on the seam between them.
  const target = boxes[best]!;
  const c = centre(target);
  const past = best > draggedIndex ? x >= c.x - target.width / 4 : x <= c.x + target.width / 4;
  const sameRow = Math.abs(c.y - y) <= target.height / 2;
  if (sameRow && !past) return draggedIndex;

  return best;
}

/**
 * Where a floor band dragged by `offsetY` should land.
 *
 * Bands are a single column and can be very different heights, so this walks
 * the stack rather than dividing by a row height: a band lands past a
 * neighbour once it has covered more than half of it.
 */
export function floorDropIndex(heights: number[], draggedIndex: number, offsetY: number): number {
  if (draggedIndex < 0 || draggedIndex >= heights.length) return draggedIndex;

  let index = draggedIndex;
  let remaining = offsetY;

  while (remaining < 0 && index > 0) {
    const above = heights[index - 1]!;
    if (-remaining < above / 2) break;
    remaining += above;
    index -= 1;
  }
  while (remaining > 0 && index < heights.length - 1) {
    const below = heights[index + 1]!;
    if (remaining < below / 2) break;
    remaining -= below;
    index += 1;
  }

  return index;
}

/**
 * The keyboard equivalent of a drag, for the lifted item at `index`.
 *
 * `columns` is how many tiles fit across the floor's grid, so Up and Down move
 * a room a row at a time the way the eye expects. Floor bands pass `columns:
 * 1`, which makes Left/Up and Right/Down the same single step. Clamped at both
 * ends: holding Down at the bottom of a floor does nothing rather than wrap.
 */
export function keyboardTarget(
  key: string,
  index: number,
  length: number,
  columns: number,
): number | null {
  const step = Math.max(1, columns);
  const clamp = (value: number) => Math.min(length - 1, Math.max(0, value));
  switch (key) {
    case 'ArrowLeft':
      return clamp(index - 1);
    case 'ArrowRight':
      return clamp(index + 1);
    case 'ArrowUp':
      return clamp(index - step);
    case 'ArrowDown':
      return clamp(index + step);
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    default:
      return null;
  }
}

/**
 * The floor ids to persist, given the stack as the owner sees it.
 *
 * The building draws the top floor first, but `reorderFloors` writes
 * `sort_order: index` — ascending, ground floor at 0 — so what is read top-down
 * has to be written bottom-up. Reversing here, in one named function, is the
 * whole reason the two views can no longer disagree about which way a hostel
 * points.
 */
export function floorOrderForSave<F extends { id: string }>(stackedTopFirst: F[]): string[] {
  return [...stackedTopFirst].reverse().map((floor) => floor.id);
}

/** True when two id lists differ — what decides whether a floor is written at all. */
export function orderChanged(before: string[], after: string[]): boolean {
  return before.length !== after.length || before.some((id, i) => id !== after[i]);
}
