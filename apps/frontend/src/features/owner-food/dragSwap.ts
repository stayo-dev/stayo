export interface DragSource {
  mealId: string;
  mealType: string;
}

export interface DropCandidate {
  mealId: string;
  mealType: string;
  rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * Which chip the finger was over when it lifted.
 *
 * Hit-testing is done against measured rects rather than DOM events because the
 * dragged chip sits above the pointer for the whole gesture — `elementFromPoint`
 * would return the chip being dragged, not the one underneath it.
 *
 * Both the point and the rects must be in the same coordinate space; this
 * function does no conversion. The caller owns that — see `measureChip` in
 * `WeeklyScheduleGrid`, which stores page coordinates because motion's
 * `PanInfo.point` is `pageX`/`pageY`, not viewport coordinates.
 */
export function findDropTarget(
  point: { x: number; y: number },
  candidates: DropCandidate[],
): string | null {
  for (const c of candidates) {
    if (point.x >= c.rect.left && point.x <= c.rect.right && point.y >= c.rect.top && point.y <= c.rect.bottom) {
      return c.mealId;
    }
  }
  return null;
}

/**
 * Same meal type, different cell.
 *
 * Mirrors `canSwap` on the server, which mirrors the rule every cell write
 * applies: an item belongs to exactly one meal type, so a breakfast item can
 * never occupy a dinner slot. Checking here means an invalid drag is refused
 * silently at the drop instead of surfacing as a 400.
 */
export function isValidDrop(source: DragSource, target: DragSource | null): boolean {
  if (!target) return false;
  if (source.mealId === target.mealId) return false;
  return source.mealType === target.mealType;
}
