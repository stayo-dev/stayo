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

/**
 * Whether a lead may be turned into a tenant invitation right now.
 *
 * **This used to be `status === "ACCEPTED"`, and that shape produced a real
 * bug.** The owner's Accept button PATCHed the lead to ACCEPTED *and then*
 * opened the Add Tenant wizard, because the conversion endpoint refused
 * anything else. Closing that wizard without sending left the lead marked
 * Accepted with no invitation behind it — an owner reading their Leads tab
 * saw four "Accepted" enquiries that nobody had actually been invited to.
 *
 * Accepting and inviting are now one act: the button opens the wizard and the
 * lead moves straight to INVITED when the invitation is really sent. So the
 * question here is no longer "has it been accepted" but "is it still open to
 * being converted at all".
 *
 * ACCEPTED stays allowed — leads parked in that state by the old flow (and by
 * the sheet's "Continue to Add Tenant") must still be convertible.
 *
 * `ON_HOLD` is allowed too, which the old rule refused. Sending an invitation
 * is a stronger commitment than accepting, so requiring an un-hold first would
 * only be ceremony — and with the eager PATCH gone, an on-hold lead whose
 * owner pressed Accept would otherwise dead-end at the wizard's submit.
 */
export function canConvertLeadToInvitation(
  status: string,
  alreadyConvertedTenantId?: string | null,
): GuardResult {
  if (alreadyConvertedTenantId) {
    return { ok: false, reason: "This enquiry is already connected to a tenant invitation." };
  }

  const normalized = String(status || "").toUpperCase();

  if (normalized === "REJECTED") {
    return { ok: false, reason: "This enquiry was rejected, so it cannot be invited." };
  }
  if (normalized === "INVITED" || normalized === "JOINED") {
    return { ok: false, reason: "This enquiry has already been converted to a tenant." };
  }
  if (normalized === "LOST") {
    return { ok: false, reason: "This enquiry is marked as not proceeding." };
  }

  if (OPEN_STATUSES.includes(normalized) || normalized === "ON_HOLD" || normalized === "ACCEPTED") {
    return { ok: true };
  }

  return { ok: false, reason: `Cannot invite this enquiry from status ${normalized}.` };
}
