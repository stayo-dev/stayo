/**
 * What an admin may do to a listing that is **already approved and live**.
 *
 * Until now the answer was "nothing". `marketingReviewService.approve()` and
 * `.reject()` both hard-require `PENDING_REVIEW`, so the moment a revision became
 * APPROVED it left the console's reach: a wrong price, a stale photo or a claim
 * that turned out to be false could only be dealt with by suspending the entire
 * hostel — removing a real, verified hostel from Discovery to fix a sentence.
 *
 * Two transitions, deliberately different in blast radius, because the two real
 * situations are different:
 *
 * - **Request changes** — "fix this" for a typo, a weak photo, a stale menu. The
 *   approved revision stays APPROVED, so the live page does not go dark while the
 *   owner gets round to it. A new DRAFT carrying the reviewer's note and flags is
 *   waiting in their editor.
 * - **Unpublish** — "this comes down now" for a false claim or a wrong price. The
 *   approved revision becomes WITHDRAWN, the listing renders as a hostel that has
 *   not published details yet, and the hostel itself stays on Discovery.
 *
 * Suspending the whole hostel remains the third, bluntest lever and is unchanged.
 *
 * This module is the decision half, kept free of I/O so it can be tested
 * directly; `marketing-review-service.ts` performs the writes.
 */

/** Statuses a revision can hold. `WITHDRAWN` is added by this change. */
export type RevisionStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED"
  | "WITHDRAWN";

/**
 * A pulled-back listing is **not** recorded as REJECTED.
 *
 * REJECTED means "this never went live" — the admin read a submission and said no.
 * WITHDRAWN means "this was live and we took it down", which is a different fact
 * about what tenants actually saw, and the distinction is the whole reason
 * SUPERSEDED exists rather than deleting old revisions. Anything that settles
 * "but the listing said ₹4,500" needs to know which of the two happened.
 */
export const WITHDRAWN: RevisionStatus = "WITHDRAWN";

/** Statuses that mean the owner has something open they can edit or submit. */
export const OPEN_STATUSES: RevisionStatus[] = ["DRAFT", "PENDING_REVIEW"];

export type PostApprovalAction = "REQUEST_CHANGES" | "UNPUBLISH";

export interface ListingSnapshot {
  /** Status of the hostel's APPROVED revision, or null when nothing is live. */
  approved: boolean;
  /** Status of any open revision the owner holds, or null. */
  openStatus: "DRAFT" | "PENDING_REVIEW" | null;
}

export type TransitionDecision =
  | { ok: true }
  | { ok: false; reason: string; code: "NOT_LIVE" | "IN_REVIEW" };

/**
 * Whether an admin may take this action right now.
 *
 * Both actions need something live to act on. `REQUEST_CHANGES` additionally
 * refuses while a submission is sitting in the queue: that submission is the
 * thing to review, and quietly writing notes onto a *different* draft would
 * leave the queue item unanswered and the owner with two sets of feedback.
 */
export function canTransition(
  action: PostApprovalAction,
  snapshot: ListingSnapshot,
): TransitionDecision {
  if (!snapshot.approved) {
    return {
      ok: false,
      code: "NOT_LIVE",
      reason: "This hostel has no live listing to act on.",
    };
  }

  if (action === "REQUEST_CHANGES" && snapshot.openStatus === "PENDING_REVIEW") {
    return {
      ok: false,
      code: "IN_REVIEW",
      reason:
        "This hostel already has a submission waiting for review — approve or send that one back instead.",
    };
  }

  return { ok: true };
}

/**
 * A reason is required, and for the same reason `reject()` requires one: a bare
 * "no" produces a resubmission of the same page. Unpublishing has no flags to
 * lean on, so the sentence is all the owner gets and it must be there.
 */
export function isActionable(action: PostApprovalAction, note: string, flagCount: number): boolean {
  const written = note.trim().length > 0;
  return action === "UNPUBLISH" ? written : written || flagCount > 0;
}

/**
 * Does the live page survive this action?
 *
 * Stated as a function rather than left implicit at the call sites, because it is
 * the single thing that distinguishes the two actions and the thing an admin is
 * actually choosing between.
 */
export function keepsListingLive(action: PostApprovalAction): boolean {
  return action === "REQUEST_CHANGES";
}

/** What the owner is told. The wording carries the consequence, not just the verdict. */
export function ownerNotification(
  action: PostApprovalAction,
  hostelName: string,
  note: string,
): { title: string; body: string } {
  if (action === "UNPUBLISH") {
    return {
      title: "Your listing has been taken down",
      body: `The Discovery listing for ${hostelName} is no longer visible to tenants. ${note.trim()} Edit and resubmit it to go live again.`,
    };
  }
  return {
    title: "Changes requested on your listing",
    body: `Stayo has asked for changes to the Discovery listing for ${hostelName}. It is still live while you work on it. ${note.trim()}`.trim(),
  };
}
