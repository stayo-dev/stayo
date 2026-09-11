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
