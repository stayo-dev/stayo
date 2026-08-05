/**
 * Whether a voting period has run past its end time and should be closed.
 *
 * Voting had no way to close itself: `voting_ends_at` was checked when a vote
 * was cast, but `status` stayed OPEN forever. That dead-ended the owner, whose
 * Generate button is gated on the period being CLOSED.
 */
export function shouldAutoClose(
  period: { status: string; voting_ends_at: Date },
  now: Date,
): boolean {
  return period.status === "OPEN" && period.voting_ends_at.getTime() <= now.getTime();
}
