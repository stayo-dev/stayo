import { describe, it, expect } from 'vitest';
import {
  deriveGettingStarted,
  deriveVerificationStatus,
  shouldRunSpotlight,
  type GettingStartedSignals,
} from './gettingStarted';

const signals = (over: Partial<GettingStartedSignals> = {}): GettingStartedSignals => ({
  roomCapacity: 0,
  tenantCount: 0,
  hasEverCollected: false,
  hostelInProgress: null,
  ...over,
});

describe('deriveGettingStarted', () => {
  it('starts a brand-new owner at the first step', () => {
    const result = deriveGettingStarted(signals());
    expect(result.visible).toBe(true);
    expect(result.steps.map((s) => s.state)).toEqual(['current', 'todo', 'todo']);
    expect(result.doneCount).toBe(0);
    expect(result.percent).toBe(0);
  });

  it('ticks the hostel step off once rooms exist and moves on', () => {
    const result = deriveGettingStarted(signals({ roomCapacity: 38 }));
    expect(result.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo']);
    expect(result.steps[0].detail).toBe('38 beds ready');
    expect(result.doneCount).toBe(1);
  });

  it('counts an invited tenant — the owner has done that work', () => {
    const result = deriveGettingStarted(signals({ roomCapacity: 10, tenantCount: 1 }));
    expect(result.steps[1].state).toBe('done');
    expect(result.steps[1].detail).toBe('1 tenant on board');
  });

  it('hides itself once all three are done', () => {
    const result = deriveGettingStarted(signals({ roomCapacity: 10, tenantCount: 3, hasEverCollected: true }));
    expect(result.isComplete).toBe(true);
    expect(result.visible).toBe(false);
    expect(result.percent).toBe(100);
  });

  it('stays hidden in a month with no rent yet, with no stored latch to help it', () => {
    // The whole reason the old `graduated` flag existed. The payment step now
    // reads a lifetime fact, so a quiet month cannot resurrect the checklist
    // on an established hostel.
    const result = deriveGettingStarted(signals({ roomCapacity: 40, tenantCount: 12, hasEverCollected: true }));
    expect(result.visible).toBe(false);
  });

  it('shows for a brand-new owner regardless of what any other account did', () => {
    // The regression that shipped this change: the latch was browser-global,
    // so one finished account hid the checklist from every account opened
    // afterwards on the same browser. There is no longer any state that could.
    expect(deriveGettingStarted(signals()).visible).toBe(true);
  });

  it('surfaces an unfinished build as the first step’s detail', () => {
    const result = deriveGettingStarted(
      signals({ hostelInProgress: { name: 'Sunrise', summary: 'Ground floor done · 3 to go' } }),
    );
    expect(result.steps[0].detail).toBe('Ground floor done · 3 to go');
  });

  it('marks the earliest incomplete step as current, even when a later one is done', () => {
    // Someone could record a payment before inviting through the app.
    const result = deriveGettingStarted(signals({ roomCapacity: 10, hasEverCollected: true }));
    expect(result.steps.map((s) => s.state)).toEqual(['done', 'current', 'done']);
    expect(result.doneCount).toBe(2);
  });

  it('pluralises real counts rather than guessing', () => {
    expect(deriveGettingStarted(signals({ roomCapacity: 1 })).steps[0].detail).toBe('1 bed ready');
  });

  it('explains why an outstanding step matters, and how long it takes', () => {
    const step = deriveGettingStarted(signals()).steps[0];
    expect(step.why).toContain('before anyone can be put in one');
    expect(step.duration).toBe('About 5 minutes');
  });

  it('drops the explanation once the step is done, leaving only the fact', () => {
    const step = deriveGettingStarted(signals({ roomCapacity: 38 })).steps[0];
    expect(step.why).toBeNull();
    expect(step.duration).toBeNull();
    expect(step.detail).toBe('38 beds ready');
  });
});

describe('shouldRunSpotlight', () => {
  const base = { roomCapacity: 0, isComplete: false, dismissed: false, ready: true };

  it('waits for the first hostel — an empty Home has nothing to point at', () => {
    expect(shouldRunSpotlight(base)).toBe(false);
  });

  it('runs once rooms exist and the dashboard has something in it', () => {
    expect(shouldRunSpotlight({ ...base, roomCapacity: 24 })).toBe(true);
  });

  it('never tours an owner who has finished setting up', () => {
    // Storage is per-device, so an established owner on a new phone reads as
    // "not dismissed". Completion is what actually stops the tour.
    expect(shouldRunSpotlight({ ...base, roomCapacity: 40, isComplete: true })).toBe(false);
  });

  it('respects a dismissal', () => {
    expect(shouldRunSpotlight({ ...base, roomCapacity: 24, dismissed: true })).toBe(false);
  });

  it('waits for the dashboard rather than spotlighting a loading screen', () => {
    expect(shouldRunSpotlight({ ...base, roomCapacity: 24, ready: false })).toBe(false);
  });
});

describe('deriveVerificationStatus', () => {
  it('reports nothing submitted without implying a problem', () => {
    const status = deriveVerificationStatus([]);
    expect(status).toMatchObject({ label: 'ID not submitted', tone: 'neutral' });
    expect(status.detail).toContain('Nothing here is blocked');
  });

  it('reports review in progress while documents are pending', () => {
    const status = deriveVerificationStatus([{ doc_type: 'AADHAAR', status: 'PENDING' }]);
    expect(status).toMatchObject({ label: 'ID verification in review', tone: 'pending' });
  });

  it('only says verified when both required documents are', () => {
    const partial = deriveVerificationStatus([
      { doc_type: 'AADHAAR', status: 'VERIFIED' },
      { doc_type: 'PAN', status: 'PENDING' },
    ]);
    expect(partial.label).toBe('ID verification in review');

    const full = deriveVerificationStatus([
      { doc_type: 'AADHAAR', status: 'VERIFIED' },
      { doc_type: 'PAN', status: 'VERIFIED' },
    ]);
    expect(full).toMatchObject({ label: 'ID verified', tone: 'success' });
  });

  it('surfaces the reviewer’s reason on a rejection so the owner knows what to fix', () => {
    const status = deriveVerificationStatus([
      { doc_type: 'PAN', status: 'REJECTED', review_note: 'Photo is blurred' },
    ]);
    expect(status).toMatchObject({ label: 'ID needs attention', tone: 'warning' });
    expect(status.detail).toBe('Photo is blurred');
  });

  it('still explains a rejection that came with no reason', () => {
    const status = deriveVerificationStatus([{ doc_type: 'PAN', status: 'REJECTED' }]);
    expect(status.detail).toContain('rejected');
  });

  it('treats missing or malformed input as nothing submitted', () => {
    expect(deriveVerificationStatus(null).label).toBe('ID not submitted');
    expect(deriveVerificationStatus(undefined).label).toBe('ID not submitted');
  });

  it('lets a rejection outrank a verified sibling — the owner still has work', () => {
    const status = deriveVerificationStatus([
      { doc_type: 'AADHAAR', status: 'VERIFIED' },
      { doc_type: 'PAN', status: 'REJECTED', review_note: 'Wrong document' },
    ]);
    expect(status.tone).toBe('warning');
  });
});
