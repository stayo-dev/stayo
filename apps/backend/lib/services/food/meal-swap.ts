export interface SwapCell {
  id: string;
  schedule_id: string;
  meal_type: string;
}

export interface SwapVerdict {
  ok: boolean;
  reason: string;
}

/**
 * Whether two schedule cells may exchange their items.
 *
 * Same-meal-type only, and deliberately so: every cell write validates that the
 * item belongs to that meal type, so a breakfast item can never legally occupy
 * a dinner slot. Refusing the swap here keeps that rule in one place rather
 * than letting the UI discover it as a 400 halfway through a drag.
 */
export function canSwap(a: SwapCell | null, b: SwapCell | null, scheduleId: string): SwapVerdict {
  if (!a || !b) return { ok: false, reason: "Meal cell not found" };
  if (a.id === b.id) return { ok: false, reason: "Cannot swap a cell with the same cell" };
  if (a.schedule_id !== scheduleId || b.schedule_id !== scheduleId) {
    return { ok: false, reason: "Both meals must belong to this schedule" };
  }
  if (a.meal_type !== b.meal_type) {
    return { ok: false, reason: "Meals can only be swapped within the same meal type" };
  }
  return { ok: true, reason: "" };
}

/**
 * Whether both halves of the swap actually wrote.
 *
 * The route writes each cell conditionally on it still holding the item the
 * transaction read, because atomicity does not order two overlapping swaps:
 * under READ COMMITTED, A(c1<->c2) and B(c2<->c3) can both read before either
 * commits, and B's stale write to c2 would duplicate one item and lose the
 * other. A zero count is the loser discovering that, and the swap is refused
 * rather than applied on top of a state it never saw.
 */
export function swapWritesLanded(aCount: number, bCount: number): SwapVerdict {
  if (aCount === 0 || bCount === 0) {
    return { ok: false, reason: "Those meals changed while you were moving them" };
  }
  return { ok: true, reason: "" };
}
