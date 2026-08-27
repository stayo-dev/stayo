/**
 * Pure validation for editing an already-published (OPEN) food poll's
 * option list. The one rule that matters: an option that already has at
 * least one vote can never be removed by an edit — votes must never
 * silently disappear. Options with zero votes may be freely removed or
 * relabeled, and new options may always be added.
 */

export interface ExistingPollOption {
  id: string;
  label: string;
  votes: number;
}

export interface RequestedPollOption {
  /** Present = edit this existing option. Absent = a new option. */
  id?: string;
  label: string;
}

export interface PollEditValidationError {
  code: "OPTION_HAS_VOTES" | "TOO_FEW_OPTIONS";
  message: string;
}

export function validatePollOptionEdits(
  existing: ExistingPollOption[],
  requested: RequestedPollOption[],
): PollEditValidationError | null {
  const requestedIds = new Set(requested.filter((o) => o.id).map((o) => o.id));
  const removed = existing.filter((o) => !requestedIds.has(o.id));
  const removedWithVotes = removed.filter((o) => o.votes > 0);
  if (removedWithVotes.length > 0) {
    return {
      code: "OPTION_HAS_VOTES",
      message: `Can't remove option(s) that already have votes: ${removedWithVotes.map((o) => o.label).join(", ")}`,
    };
  }

  if (requested.length < 2) {
    return { code: "TOO_FEW_OPTIONS", message: "At least 2 options are required" };
  }

  return null;
}
