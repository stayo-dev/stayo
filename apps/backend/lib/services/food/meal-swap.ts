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
