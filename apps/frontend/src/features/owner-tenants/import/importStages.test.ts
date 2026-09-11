import { describe, expect, it } from 'vitest';
import {
  canGoBack,
  completedStages,
  hostelChangeDiscardsBatch,
  navigationFor,
  stageFor,
  stepNumber,
  type ImportState,
} from './importStages';

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

describe('moving around the flow', () => {
  const at = (over: Partial<ImportState> = {}): ImportState => ({
    hostelId: 'h1',
    templateDownloaded: true,
    batchId: 'b1',
    imported: false,
    importing: false,
    queuedInvitations: 0,
    anySent: false,
    ...over,
  });

  it('shows the furthest step when the owner has not stepped away', () => {
    expect(navigationFor(at(), null).current).toBe('REVIEW');
  });

  /**
   * The old Back reset the importer to return from Check to Upload, so a
   * glance at the previous step destroyed the batch the owner had just spent
   * a spreadsheet's worth of effort on.
   */
  it('lets the owner look back at a step without losing their place', () => {
    const nav = navigationFor(at(), 'UPLOAD');

    expect(nav.current).toBe('UPLOAD');
    expect(nav.furthest).toBe('REVIEW');
    expect(nav.forward).toBe('REVIEW');
  });

  it('offers every step already reached, and none that is not', () => {
    expect(navigationFor(at(), null).reachable).toEqual([
      'CHOOSE_HOSTEL',
      'DOWNLOAD',
      'UPLOAD',
      'REVIEW',
    ]);
  });

  it('refuses a stage the owner has not got to', () => {
    expect(navigationFor(at(), 'SEND').current).toBe('REVIEW');
  });

  it('has nothing before the first step', () => {
    expect(navigationFor(at({ hostelId: null, batchId: null }), null).back).toBeNull();
  });

  it('has nothing beyond the furthest step', () => {
    expect(navigationFor(at(), 'REVIEW').forward).toBeNull();
  });

  describe('once tenants are being created', () => {
    it('locks while the import runs', () => {
      const nav = navigationFor(at({ importing: true }), 'UPLOAD');

      expect(nav.locked).toBe(true);
      expect(nav.current).toBe('IMPORT');
      expect(nav.back).toBeNull();
    });

    /**
     * Not a nicety: Upload is reachable again only if a second run cannot
     * create the same people twice, and it can.
     */
    it('stays locked afterwards', () => {
      const nav = navigationFor(at({ imported: true, queuedInvitations: 3 }), 'UPLOAD');

      expect(nav.current).toBe('SEND');
      expect(nav.reachable).toEqual(['SEND']);
    });
  });
});

describe('stepping back to the hostel picker', () => {
  const state: ImportState = {
    hostelId: 'h1',
    templateDownloaded: true,
    batchId: 'b1',
    imported: false,
    importing: false,
    queuedInvitations: 0,
    anySent: false,
  };

  it('keeps the work when the same hostel is picked again', () => {
    expect(hostelChangeDiscardsBatch(state, 'h1')).toBe(false);
  });

  /** A batch is validated against one hostel's rooms. */
  it('discards it when a different one is', () => {
    expect(hostelChangeDiscardsBatch(state, 'h2')).toBe(true);
  });

  it('has nothing to discard before an upload', () => {
    expect(hostelChangeDiscardsBatch({ ...state, batchId: null }, 'h2')).toBe(false);
  });
});

describe('counting steps for the owner', () => {
  it('counts from one', () => {
    expect(stepNumber('CHOOSE_HOSTEL')).toBe(1);
    expect(stepNumber('SEND')).toBe(6);
  });
});
