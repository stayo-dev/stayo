/**
 * The two decisions inside `moveOutService.quickExit` that can break silently,
 * pulled out as pure functions so they can be tested without a database.
 *
 * Both exist for the same reason: quick exit collapses five owner-visible
 * checkpoints into one tap, so the checks that used to be implicit in "the
 * owner looked at the screen again" have to become explicit and verified.
 *
 * PURE — no I/O, no Prisma. Runs under `vitest.pure.config.ts`.
 */

import { canonicalMoveOutStatus } from "./move-out-status";

export type QuickExitStep = "INSPECTED" | "SETTLED" | "VACATED" | "COMPLETED";

/**
 * Which hops still have to run, given where the request actually is now.
 *
 * Quick exit is resumable rather than atomic — the underlying methods each
 * open their own transaction, so a failure partway leaves a consistent
 * request at an earlier state and the owner simply taps again. That only
 * works if the second call skips what already happened, which is what this
 * table decides. Getting it wrong doesn't fail loudly: it throws
 * INVALID_TRANSITION from deep inside the state machine, or worse, re-runs a
 * step that was already applied.
 *
 * Mirrors the graph in `move-out-state-machine.ts`. Legacy `APPROVED` /
 * `VACATED` statuses are canonicalised first, so a request written before the
 * rename resumes correctly instead of falling through to "nothing to do".
 */
export function planQuickExitSteps(currentStatus: string): QuickExitStep[] {
  switch (canonicalMoveOutStatus(currentStatus)) {
    case "REQUESTED":
      return ["INSPECTED", "SETTLED", "VACATED", "COMPLETED"];
    case "SETTLEMENT_PENDING":
      return ["SETTLED", "VACATED", "COMPLETED"];
    case "SETTLEMENT_APPROVED":
      return ["VACATED", "COMPLETED"];
    case "PHYSICALLY_VACATED":
    case "SETTLEMENT_PENDING_PAYMENT":
      return ["COMPLETED"];
    default:
      // COMPLETED, REJECTED, or anything unrecognised: nothing to do. The
      // caller reports the current status rather than forcing a transition.
      return [];
  }
}

export interface SettlementFigures {
  net_settlement_amount: number;
  settlement_direction: string;
}

/**
 * Has the settlement moved since the owner looked at it?
 *
 * This is the guard that makes one-tap safe. Between the sheet rendering a
 * number and the owner tapping confirm, a payment can land, a late fee can
 * post, or another device can record an inspection — and the owner would
 * then close an outcome they never saw. In the five-screen flow the owner
 * re-read the figure at every step; here they read it once, so the server
 * has to check that it still holds.
 *
 * Tolerance is one paisa. The preview rounds to 2dp (`round2`) and the
 * number survives a JSON round trip, so an exact `!==` would reject on float
 * representation alone; anything looser would let a real rupee through.
 */
export function detectSettlementDrift(
  actual: SettlementFigures,
  expected: { net: number; direction: string },
): { drifted: boolean; reason?: "AMOUNT" | "DIRECTION" } {
  if (actual.settlement_direction !== expected.direction) {
    return { drifted: true, reason: "DIRECTION" };
  }
  if (Math.abs(Number(actual.net_settlement_amount) - Number(expected.net)) > 0.01) {
    return { drifted: true, reason: "AMOUNT" };
  }
  return { drifted: false };
}
