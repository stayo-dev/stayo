/**
 * Where the owner is in the import, and what they have already done.
 *
 * The stepper exists because this flow spans a download, a spreadsheet, an
 * upload and a wait — an owner who loses their place in that has no way to
 * tell whether anything they did stuck. Deriving the stage from state, rather
 * than tracking it as a separate counter, means it stays right when they close
 * the tab and come back to the batch.
 */

export const STAGES = ['CHOOSE_HOSTEL', 'DOWNLOAD', 'UPLOAD', 'REVIEW', 'IMPORT', 'SEND'] as const;
export type Stage = (typeof STAGES)[number];

export interface ImportState {
  hostelId: string | null;
  templateDownloaded: boolean;
  batchId: string | null;
  /** True once every row has been attempted. */
  imported: boolean;
  /** True while chunks are still running — the progress bar's stage. */
  importing: boolean;
  queuedInvitations: number;
  /** True once the owner has sent at least one wave. */
  anySent: boolean;
}

export const STAGE_LABELS: Record<Stage, string> = {
  CHOOSE_HOSTEL: 'Hostel',
  DOWNLOAD: 'Get the sheet',
  UPLOAD: 'Upload',
  REVIEW: 'Check',
  IMPORT: 'Import',
  SEND: 'Send invites',
};

export function stageFor(state: ImportState): Stage {
  if (!state.hostelId) return 'CHOOSE_HOSTEL';
  // Once a batch exists the download is behind them, whether or not this
  // session is the one that downloaded it.
  if (state.batchId) {
    // Running: the determinate bar has its own stage, or it would never show.
    if (state.importing) return 'IMPORT';
    if (!state.imported) return 'REVIEW';
    // After the import, sending is the last step — including once everything
    // has gone out, so the owner sees that it did rather than being bounced
    // back to the progress screen.
    return state.queuedInvitations > 0 || state.anySent ? 'SEND' : 'IMPORT';
  }
  return state.templateDownloaded ? 'UPLOAD' : 'DOWNLOAD';
}

export function completedStages(state: ImportState): Stage[] {
  const current = STAGES.indexOf(stageFor(state));
  return STAGES.slice(0, Math.max(0, current));
}

/**
 * What the owner can still do from here.
 *
 * Going back to re-upload is always allowed until the import runs; afterwards
 * it is not, because the tenancies exist and a second upload would create them
 * again.
 */
export function canGoBack(state: ImportState): boolean {
  return !state.imported;
}

/** 1-based, for "Step 3 of 6" — owners do not count from zero. */
export function stepNumber(stage: Stage): number {
  return STAGES.indexOf(stage) + 1;
}

export interface Navigation {
  /** The step on screen. */
  current: Stage;
  /** The furthest the owner's real progress has taken them. */
  furthest: Stage;
  /** Steps they may jump straight to. */
  reachable: Stage[];
  back: Stage | null;
  forward: Stage | null;
  /**
   * True when the flow has stopped being a sequence the owner drives — the
   * import is running or has run. Nothing is navigable then.
   */
  locked: boolean;
}

/**
 * Where the owner is, where they may go, and how they get there.
 *
 * Two different questions were being answered by one value. `stageFor` says
 * what their *progress* is; this adds what they are currently *looking at*,
 * which are not the same thing the moment they step back to re-read something.
 * Keeping the two apart is what lets Back be a genuine move rather than a
 * reset — the old Back threw the batch away to return to Upload, so a glance
 * at the previous step cost the owner their whole upload.
 *
 * Going back is free because none of the first four steps change anything:
 * the workbook, the upload and the review all happen before a single tenant
 * exists. Once Import has started that stops being true, so navigation locks —
 * a second pass over Upload would create everyone twice.
 */
export function navigationFor(state: ImportState, viewing: Stage | null): Navigation {
  const furthest = stageFor(state);
  const furthestIndex = STAGES.indexOf(furthest);
  const locked = state.importing || state.imported;

  // A stage the owner has not reached yet is not somewhere they can be, and
  // neither is anywhere but the live one once tenants are being created.
  const reachable = locked ? [furthest] : STAGES.slice(0, furthestIndex + 1);

  const current = viewing && reachable.includes(viewing) ? viewing : furthest;
  const currentIndex = STAGES.indexOf(current);

  return {
    current,
    furthest,
    reachable,
    back: currentIndex > 0 && reachable.includes(STAGES[currentIndex - 1])
      ? STAGES[currentIndex - 1]
      : null,
    forward: currentIndex < furthestIndex ? STAGES[currentIndex + 1] : null,
    locked,
  };
}

/**
 * Whether stepping back to the hostel picker and choosing differently has to
 * throw the work away.
 *
 * It does, and only then: a batch is validated against one hostel's rooms, so
 * carrying it to another would import tenants into rooms that are not theirs.
 * Re-picking the same hostel must cost nothing, or Back becomes a trap again.
 */
export function hostelChangeDiscardsBatch(state: ImportState, nextHostelId: string | null): boolean {
  return Boolean(state.batchId) && nextHostelId !== state.hostelId;
}
