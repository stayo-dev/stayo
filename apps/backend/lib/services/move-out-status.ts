/**
 * Move-out status vocabulary, with no imports.
 *
 * Split out of `move-out-state-machine.ts` because that module imports
 * `prisma` (for `checkCapability`), so anything reaching for a status name
 * transitively opened a database connection — which made the status logic
 * untestable under `vitest.pure.config.ts` and dragged `lib/db` into places
 * that only ever wanted to compare two strings.
 *
 * The state machine re-exports these, so there is still exactly one
 * definition of what a status is called and how a legacy one maps forward.
 *
 * PURE — no I/O.
 */

export const MOVE_OUT_STATUS = {
  REQUESTED: "REQUESTED",
  SETTLEMENT_PENDING: "SETTLEMENT_PENDING",
  SETTLEMENT_APPROVED: "SETTLEMENT_APPROVED",
  PHYSICALLY_VACATED: "PHYSICALLY_VACATED",
  SETTLEMENT_PENDING_PAYMENT: "SETTLEMENT_PENDING_PAYMENT",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
} as const;

/**
 * `APPROVED` and `VACATED` are the pre-rename spellings. They are still
 * readable in the database and must keep mapping forward — a request written
 * before the rename otherwise looks like an unrecognised state and silently
 * falls out of every switch.
 */
export const LEGACY_STATUS_ALIASES: Record<string, string> = {
  APPROVED: MOVE_OUT_STATUS.SETTLEMENT_APPROVED,
  VACATED: MOVE_OUT_STATUS.PHYSICALLY_VACATED,
};

export function canonicalMoveOutStatus(status: string): string {
  return LEGACY_STATUS_ALIASES[status] || status;
}

export const TERMINAL_MOVE_OUT_STATUSES: readonly string[] = [
  MOVE_OUT_STATUS.COMPLETED,
  MOVE_OUT_STATUS.REJECTED,
];
