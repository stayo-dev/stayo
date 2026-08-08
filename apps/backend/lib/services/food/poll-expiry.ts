/**
 * Whether a poll has run past its closing time and should be closed.
 * Mirrors `shouldAutoClose` in `voting-expiry.ts` for the same reason: a
 * poll has no other way to close itself once `closes_at` passes.
 */
export function shouldAutoClosePoll(
  poll: { status: string; closes_at: Date },
  now: Date,
): boolean {
  return poll.status === "OPEN" && poll.closes_at.getTime() <= now.getTime();
}
