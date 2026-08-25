/**
 * Asking to move out.
 *
 * The backend has accepted tenant-initiated move-outs all along —
 * `POST /api/move-out/requests` reads the session and sets
 * `initiatedByRole = "TENANT"` itself — and feeds a real owner pipeline
 * (vacate → inspect → settle). There was simply no way for a tenant to say so.
 *
 * PURE — the sheet is a renderer over this.
 */

/** Mirrors the `MoveOutReason` enum. Order is the order a tenant reads them. */
export const MOVE_OUT_REASONS = [
  { value: 'COURSE_COMPLETED', label: 'My course finished' },
  { value: 'JOB_RELOCATION', label: 'Job or internship elsewhere' },
  { value: 'MOVING_CLOSER', label: 'Moving closer to college or work' },
  { value: 'TOO_EXPENSIVE', label: 'Too expensive' },
  { value: 'ROOMMATE_ISSUES', label: 'Roommate issues' },
  { value: 'POOR_MAINTENANCE', label: 'Maintenance problems' },
  { value: 'FOOD_QUALITY', label: 'Food quality' },
  { value: 'SAFETY_CONCERNS', label: 'Safety concerns' },
  { value: 'RULES_TOO_STRICT', label: 'Rules are too strict' },
  { value: 'BETTER_HOSTEL', label: 'Found somewhere better' },
  { value: 'PERSONAL_REASONS', label: 'Personal reasons' },
  { value: 'OTHER', label: 'Something else' },
] as const;

export type MoveOutReasonValue = (typeof MOVE_OUT_REASONS)[number]['value'];

/** `YYYY-MM-DD` for today, from local parts — never `toISOString()`, which is UTC. */
export function todayISO(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export type MoveOutValidation = { ok: boolean; message: string };

/**
 * Whether this request can be sent.
 *
 * Deliberately permissive about *when*: this asks the owner, it does not
 * announce a departure, and a tenant whose plans changed yesterday should still
 * be able to raise it. The only date it refuses is one in the past, which is a
 * typo rather than an intention.
 *
 * "Something else" asks for a sentence, because an owner receiving `OTHER` with
 * no text has been told nothing at all.
 */
export function validateMoveOut(input: {
  reason: string;
  reasonText: string;
  plannedExitDate: string;
  today: string;
}): MoveOutValidation {
  if (!input.reason) return { ok: false, message: 'Pick a reason so the hostel knows what to do' };
  if (input.reason === 'OTHER' && !input.reasonText.trim()) {
    return { ok: false, message: 'Tell them briefly what’s changed' };
  }
  if (!input.plannedExitDate) return { ok: false, message: 'Choose the date you plan to leave' };
  if (input.plannedExitDate < input.today) {
    return { ok: false, message: 'That date has already passed' };
  }
  if (input.reasonText.length > 1000) {
    return { ok: false, message: 'Keep it under 1000 characters' };
  }
  return { ok: true, message: '' };
}

/**
 * What actually happens next, said plainly.
 *
 * A generic "Are you sure?" tells nobody anything. Moving out starts a
 * settlement of the deposit and dues, frees the bed, and puts the request in
 * front of the owner — a tenant is entitled to know that before tapping, not
 * after.
 */
export function moveOutConsequences(): string[] {
  return [
    'Your hostel is notified and will confirm the date with you.',
    'Your deposit and any dues are settled after you leave.',
    'Your bed becomes available for someone else from that date.',
  ];
}
