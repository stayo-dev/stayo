/**
 * Who may review a hostel.
 *
 * **Only people who have actually lived there.** A review is a report on
 * experience, and someone who browsed a listing has no experience of the
 * building, the food, or the warden. This is stricter than where reviews
 * started (any signed-in account could write one, with a "stayed here" badge
 * for those who had) — and the badge turned out to be the wrong instrument:
 * it labelled the trustworthy reviews instead of excluding the rest, which
 * leaves a hostel's public page open to anyone with an account and an opinion.
 * See ADR-086.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

/**
 * The two tenancy states that mean "I lived here".
 *
 * `INVITED` is an invitation not yet taken up — that person has never spent a
 * night in the building. `CANCELLED` and `EXPIRED` are invitations that fell
 * through, which is the same thing. Only a tenancy that started counts.
 */
export const REVIEW_ELIGIBLE_TENANCY_STATUSES = new Set(["ACTIVE", "FORMER_TENANT"]);

export type ReviewEligibility =
  | { canReview: true; tenancy: "ACTIVE" | "FORMER" }
  /** Why not, in words the person reads on the listing. */
  | { canReview: false; reason: "SIGNED_OUT" | "NOT_A_RESIDENT" };

export function reviewEligibility(input: {
  signedIn: boolean;
  /** Every tenancy this account holds *at this hostel*, whatever its state. */
  tenancyStatuses: string[];
}): ReviewEligibility {
  if (!input.signedIn) return { canReview: false, reason: "SIGNED_OUT" };

  const eligible = input.tenancyStatuses.filter((status) =>
    REVIEW_ELIGIBLE_TENANCY_STATUSES.has(String(status).toUpperCase()),
  );
  if (eligible.length === 0) return { canReview: false, reason: "NOT_A_RESIDENT" };

  // A current resident is reporting on a stay in progress; a former one on a
  // stay that finished. Both are real, and the listing says which.
  return {
    canReview: true,
    tenancy: eligible.some((status) => String(status).toUpperCase() === "ACTIVE") ? "ACTIVE" : "FORMER",
  };
}
