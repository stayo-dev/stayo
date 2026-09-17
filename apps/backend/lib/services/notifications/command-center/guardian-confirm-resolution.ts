/**
 * What to do when a guardian taps [Yes, I confirm].
 *
 * One handset can be the guardian of more than one resident — siblings in the
 * same hostel, or two students whose parent is the same person. The tap itself
 * carries no tenancy: a template quick reply delivers only the payload we chose
 * at template-creation time, identical for every recipient. So the tenancy has
 * to be inferred from what is outstanding for that number, and "more than one"
 * is a real case that must be asked about rather than guessed at — confirming
 * the wrong ward would attach a proof to a tenancy nobody vouched for.
 *
 * PURE MODULE. The caller reads the pending requests and performs the write.
 */

export interface PendingGuardianRequest {
  requestId: string;
  tenantId: string;
  tenantName: string;
  hostelName: string;
}

export type GuardianConfirmResolution =
  /** Nothing outstanding — an old button, or a tap after the request expired. */
  | { kind: "NOTHING_PENDING" }
  /** Exactly one. Confirm it. */
  | { kind: "CONFIRM"; request: PendingGuardianRequest }
  /** Several. Ask which, rather than picking one. */
  | { kind: "ASK_WHICH"; requests: PendingGuardianRequest[] };

export function resolveGuardianConfirmation(
  pending: PendingGuardianRequest[],
): GuardianConfirmResolution {
  if (pending.length === 0) return { kind: "NOTHING_PENDING" };
  if (pending.length === 1) return { kind: "CONFIRM", request: pending[0] };
  return { kind: "ASK_WHICH", requests: pending };
}

/**
 * What the guardian reads back.
 *
 * Third person throughout, matching the rest of the guardian-facing vocabulary
 * — this reader is not the resident and should never be addressed as though
 * they were.
 */
export function guardianConfirmReply(resolution: GuardianConfirmResolution): string {
  switch (resolution.kind) {
    case "NOTHING_PENDING":
      // Deliberately not an error. A guardian who taps a stale button has done
      // nothing wrong, and telling them so would be the channel's second-ever
      // message to them.
      return "Thanks — there is nothing waiting for your confirmation right now.";
    case "CONFIRM":
      return `Thank you. You are now confirmed as ${resolution.request.tenantName}'s guardian at ${resolution.request.hostelName}. Type *HELP* to see what you can do here.`;
    case "ASK_WHICH":
      return [
        "You are listed as the guardian for more than one resident. Which one are you confirming?",
        ...resolution.requests.map((request, index) => `${index + 1}. ${request.tenantName} — ${request.hostelName}`),
        "Reply with the number.",
      ].join("\n");
  }
}

/**
 * Which request a numbered reply selects, or null if the reply is not a valid
 * choice. Out-of-range and non-numeric both return null: the caller re-asks
 * rather than acting on a guess.
 */
export function selectGuardianRequestByReply(
  requests: PendingGuardianRequest[],
  body: string,
): PendingGuardianRequest | null {
  const match = String(body || "").trim().match(/^(\d{1,2})$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < requests.length ? requests[index] : null;
}
