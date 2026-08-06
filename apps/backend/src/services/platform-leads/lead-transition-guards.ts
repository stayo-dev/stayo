/**
 * Guards for admin-initiated lead transitions.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

const REJECTABLE_STATUSES = ["NEW", "UNDER_REVIEW"];

/**
 * A lead can only be declined while it is still under consideration. Once
 * approveLead() has issued an activation link, declining would mean
 * cancelling a live invitation — a different operation with its own
 * side effects (the token stays valid until explicitly CANCELLED), so this
 * refuses rather than doing half of it.
 */
export function canRejectLead(status: string): GuardResult {
  const normalized = String(status || "").toUpperCase();
  if (REJECTABLE_STATUSES.includes(normalized)) return { ok: true };
  if (normalized === "LOST") {
    return { ok: false, reason: "This lead has already been marked as not proceeding." };
  }
  return {
    ok: false,
    reason:
      `Cannot reject a lead at status ${normalized} — an activation link has already been issued. ` +
      "Cancel the invitation first.",
  };
}
