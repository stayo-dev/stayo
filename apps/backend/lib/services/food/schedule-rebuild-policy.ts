export type RebuildMode = "BUILD" | "FILL_GAPS" | "START_OVER";

export interface RebuildInput {
  mode: RebuildMode;
  currentStatus: "DRAFT" | "PUBLISHED" | null;
}

export interface RebuildDecision {
  allowed: boolean;
  replace: "ALL" | "EMPTY_ONLY";
  nextStatus: "DRAFT" | null;
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
    return { allowed: true, replace: "EMPTY_ONLY", nextStatus: null, reason: "Filled empty meals only" };
  }

  if (currentStatus === "PUBLISHED") {
    return {
      allowed: false,
      replace: "EMPTY_ONLY",
      nextStatus: null,
      reason: "This month is already published. Fill gaps instead, or edit individual meals.",
    };
  }

  if (mode === "START_OVER") {
    return { allowed: true, replace: "ALL", nextStatus: "DRAFT", reason: "Started over" };
  }

  return {
    allowed: true,
    replace: "ALL",
    nextStatus: "DRAFT",
    reason: currentStatus === null ? "New schedule" : "Rebuilt draft",
  };
}
