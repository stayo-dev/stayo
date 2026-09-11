import { describe, expect, it } from 'vitest';
import { canGoBack, completedStages, stageFor, type ImportState } from './importStages';

const state = (over: Partial<ImportState> = {}): ImportState => ({
  hostelId: null,
  templateDownloaded: false,
  batchId: null,
  imported: false,
  importing: false,
  queuedInvitations: 0,
  anySent: false,
  ...over,
});

describe('stageFor', () => {
  it('starts by asking which hostel', () => {
    expect(stageFor(state())).toBe('CHOOSE_HOSTEL');
  });

  it('then offers the sheet', () => {
    expect(stageFor(state({ hostelId: 'h1' }))).toBe('DOWNLOAD');
  });

  it('waits for the upload once the sheet is in their hands', () => {
    expect(stageFor(state({ hostelId: 'h1', templateDownloaded: true }))).toBe('UPLOAD');
  });

  it('goes to review as soon as a batch exists', () => {
    expect(stageFor(state({ hostelId: 'h1', batchId: 'b1' }))).toBe('REVIEW');
  });

  it('skips the download when the owner returns to an existing batch', () => {
    // They may have downloaded it yesterday, or on another device.
    expect(stageFor(state({ hostelId: 'h1', templateDownloaded: false, batchId: 'b1' }))).toBe('REVIEW');
  });

  it('shows the progress bar while chunks are still running', () => {
    // Without its own stage the bar never appears: the owner would sit on the
    // review screen with nothing happening.
    expect(stageFor(state({ hostelId: 'h1', batchId: 'b1', importing: true }))).toBe('IMPORT');
  });

  it('stays on sending once everything has gone out, rather than bouncing back', () => {
    expect(
      stageFor(state({ hostelId: 'h1', batchId: 'b1', imported: true, queuedInvitations: 0, anySent: true }))
    ).toBe('SEND');
  });

  it('lands on sending once the import has run and invitations are waiting', () => {
    expect(stageFor(state({ hostelId: 'h1', batchId: 'b1', imported: true, queuedInvitations: 40 }))).toBe('SEND');
  });

  it('stays on import when everything ran but nothing is left to send', () => {
    expect(stageFor(state({ hostelId: 'h1', batchId: 'b1', imported: true, queuedInvitations: 0 }))).toBe('IMPORT');
  });
});

describe('completedStages', () => {
  it('is empty at the start', () => {
    expect(completedStages(state())).toEqual([]);
  });

  it('marks everything before where they are', () => {
    expect(completedStages(state({ hostelId: 'h1', batchId: 'b1' }))).toEqual([
      'CHOOSE_HOSTEL',
      'DOWNLOAD',
      'UPLOAD',
    ]);
  });
});

describe('canGoBack', () => {
  it('lets the owner re-upload while nothing has been created', () => {
    expect(canGoBack(state({ hostelId: 'h1', batchId: 'b1' }))).toBe(true);
  });

  it('stops them once the tenancies exist, so a second upload cannot double them', () => {
    expect(canGoBack(state({ hostelId: 'h1', batchId: 'b1', imported: true }))).toBe(false);
  });
});
