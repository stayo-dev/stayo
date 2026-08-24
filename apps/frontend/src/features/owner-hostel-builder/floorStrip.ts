import { floorBlocker, type DraftFloor } from './hostelBuilder';

/**
 * The floor switcher on the Rooms step, and what it changes about saving.
 *
 * The builder used to walk floors strictly forward: Back one, "Save floor &
 * continue" one. That made a floor's position in the queue its only identity —
 * to fix a room on the ground floor from the second, you reversed through
 * everything between. The strip lets the owner go straight there.
 *
 * **Free navigation removes a guarantee the linear flow gave for free.** You
 * could not previously reach floor 3 without floor 1 having been written on
 * the way past. Now you can, so the finish has to sweep up every floor that
 * still holds unsaved rooms — otherwise an owner fills the ground floor, taps
 * across to the second, presses finish, and the ground floor's rooms never
 * reach the server.
 *
 * That sweep is only cheap because saving a floor is idempotent
 * ([[Decisions#ADR-097|ADR-097]]): re-saving one that is already saved is a
 * no-op rather than the `Room 101 already exists` conflict it used to be.
 *
 * PURE MODULE — `apps/frontend` tests run without a DOM, and a switcher that
 * silently drops a floor's work is the worst thing this screen could do.
 */

export type FloorChipState =
  /** Written to the server. */
  | 'saved'
  /** Has rooms the owner has entered, not yet written. */
  | 'draft'
  /** No rooms yet — this floor still needs the owner. */
  | 'empty';

export function floorChipState(floor: DraftFloor): FloorChipState {
  if (!floor || floor.rooms.length === 0) return 'empty';
  return floor.saved ? 'saved' : 'draft';
}

/**
 * Floors holding rooms that have never been written.
 *
 * What the finish sweeps. A floor with no rooms is not in here — there is
 * nothing to save, and `floorBlocker` would refuse it anyway.
 */
export function unsavedFloorIndexes(floors: DraftFloor[]): number[] {
  return (floors ?? [])
    .map((floor, index) => (floorChipState(floor) === 'draft' ? index : -1))
    .filter((index) => index >= 0);
}

/**
 * The next floor that still needs the owner, searching forward from `from`
 * and then wrapping to the start.
 *
 * "Needs the owner" means **no rooms yet** — a floor with rooms is done as far
 * as input goes, whether or not it has been written, because the sweep will
 * write it. Wrapping matters once navigation is free: finishing the last floor
 * should send you back to the ground floor you skipped, not to Review.
 */
export function nextFloorNeedingRooms(floors: DraftFloor[], from: number): number | null {
  const list = floors ?? [];
  if (list.length === 0) return null;

  for (let step = 1; step <= list.length; step += 1) {
    const index = (from + step) % list.length;
    if (floorChipState(list[index]) === 'empty') return index;
  }
  return null;
}

export type PrimaryFloorAction =
  | { kind: 'continue'; nextIndex: number }
  | { kind: 'finish' };

/**
 * What the footer button does from here.
 *
 * Previously it always went to `activeIndex + 1`, which with a switcher would
 * march the owner past floors they had already filled and stop short of ones
 * they had skipped.
 */
export function primaryFloorAction(floors: DraftFloor[], activeIndex: number): PrimaryFloorAction {
  const next = nextFloorNeedingRooms(floors, activeIndex);
  return next === null ? { kind: 'finish' } : { kind: 'continue', nextIndex: next };
}

export function primaryFloorLabel(action: PrimaryFloorAction): string {
  return action.kind === 'finish' ? 'Save floor & finish' : 'Save floor & continue';
}

/**
 * Why the finish cannot run yet, or null.
 *
 * Every floor about to be swept is validated up front, so the owner is told
 * which floor is wrong *before* a partial sweep writes some floors and fails
 * on another. `floorBlocker` is the same rule the active floor already uses.
 */
export function sweepBlocker(floors: DraftFloor[]): { index: number; reason: string } | null {
  for (const index of unsavedFloorIndexes(floors)) {
    const reason = floorBlocker(floors[index]);
    if (reason) return { index, reason: `${floors[index].name}: ${reason}` };
  }
  return null;
}
