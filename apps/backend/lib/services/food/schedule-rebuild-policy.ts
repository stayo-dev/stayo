export type RebuildMode = "BUILD" | "FILL_GAPS" | "START_OVER";

export interface RebuildInput {
  mode: RebuildMode;
  currentStatus: "DRAFT" | "PUBLISHED" | null;
}

export interface RebuildDecision {
  allowed: boolean;
  replace: "ALL" | "EMPTY_ONLY";
  nextStatus: "DRAFT" | null;
  /**
   * Whether this run may rewrite `source` / `generated_from_voting_period_id`.
   *
   * Only a run that replaces the whole week authored it. A `FILL_GAPS` run is
   * purely additive, so a month carried forward from last month must keep
   * saying `CARRIED_FORWARD` — that field is the sole basis for "carried
   * forward" vs "built from student votes", and the votes publish check reads
   * `generated_from_voting_period_id` as its honest input.
   */
  rewritesProvenance: boolean;
  reason: string;
}

/**
 * Decides what a rebuild request is permitted to touch.
 *
 * The rule this exists to enforce: **a PUBLISHED schedule is never demoted to
 * DRAFT and never has its cells wholesale deleted.** Before this, any re-run of
 * the generator did both, which emptied every tenant's Food tab — the tenant
 * read filters on `status: "PUBLISHED"`.
 *
 * `FILL_GAPS` is the only mode allowed against a published month because it is
 * purely additive: it writes unassigned cells and leaves status alone.
 */
export function decideRebuild({ mode, currentStatus }: RebuildInput): RebuildDecision {
  if (mode === "FILL_GAPS") {
    return { allowed: true, replace: "EMPTY_ONLY", nextStatus: null, rewritesProvenance: false, reason: "Filled empty meals only" };
  }

  if (currentStatus === "PUBLISHED") {
    return {
      allowed: false,
      replace: "EMPTY_ONLY",
      nextStatus: null,
      rewritesProvenance: false,
      reason: "This month is already published. Fill gaps instead, or edit individual meals.",
    };
  }

  if (mode === "START_OVER") {
    return { allowed: true, replace: "ALL", nextStatus: "DRAFT", rewritesProvenance: true, reason: "Started over" };
  }

  return {
    allowed: true,
    replace: "ALL",
    nextStatus: "DRAFT",
    rewritesProvenance: true,
    reason: currentStatus === null ? "New schedule" : "Rebuilt draft",
  };
}
