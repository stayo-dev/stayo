/**
 * Guards for the owner Leads tab's Accept / Hold / Reject actions on a
 * `visitor_leads` row.
 *
 * Follows `platform-leads/lead-transition-guards.ts` deliberately (same
 * `GuardResult` shape), but this one governs a different set of statuses —
 * the pre-existing admissions funnel (NEW → INTERESTED → ... → INVITED →
 * JOINED, or LOST) is untouched; this guard only applies when the target
 * status is one of the three new ones.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Still "under consideration" — the owner hasn't decided yet. */
const OPEN_STATUSES = ["NEW", "INTERESTED", "ROOM_VISITED", "DECISION_PENDING", "READY_TO_JOIN"];

/**
 * NEW (or any open sub-status) → ACCEPTED, ON_HOLD, or REJECTED.
 * ON_HOLD → ACCEPTED or REJECTED (and re-holding, to update the message).
 * REJECTED is terminal: no reopening mechanism exists in the product today,
 * so REJECTED → anything is refused, matching what was asked for.
 * A lead already converted (INVITED/JOINED) cannot be re-accepted/held/
 * rejected — that would mean acting on a lead that already has a tenant.
 */
export function canTransitionLeadStatus(current: string, next: "ACCEPTED" | "ON_HOLD" | "REJECTED"): GuardResult {
  const normalized = String(current || "").toUpperCase();

  if (normalized === "REJECTED") {
    return { ok: false, reason: "This enquiry has already been rejected." };
  }
  if (normalized === "INVITED" || normalized === "JOINED") {
    return { ok: false, reason: "This enquiry has already been converted to a tenant." };
  }
  if (normalized === "LOST") {
    return { ok: false, reason: "This enquiry has already been marked as not proceeding." };
  }

  if (next === "ON_HOLD") {
    // Re-holding an already-on-hold lead just updates the reason message.
    if (OPEN_STATUSES.includes(normalized) || normalized === "ON_HOLD") return { ok: true };
    return { ok: false, reason: `Cannot put this enquiry on hold from status ${normalized}.` };
  }

  // ACCEPTED and REJECTED are reachable from any open status or from ON_HOLD.
  if (OPEN_STATUSES.includes(normalized) || normalized === "ON_HOLD") return { ok: true };

  return { ok: false, reason: `Cannot change this enquiry's status from ${normalized}.` };
}
