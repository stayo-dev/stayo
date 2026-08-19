import { describe, expect, it } from 'vitest';
import { listingLifecycle, primaryActionLabel } from './listingLifecycle';

const content = {} as any;
const draft = (over: any = {}) => ({ id: null, version: 1, status: 'DRAFT', content, ...over });
const published = (over: any = {}) => ({ id: 'p', version: 3, content, reviewed_at: '2026-08-19T13:55:00Z', ...over });

describe('listingLifecycle', () => {
  it('says draft when nothing has ever been submitted', () => {
    const state = listingLifecycle({ draft: draft(), published: null, last_rejection: null }, false);
    expect(state.key).toBe('DRAFT');
    expect(state.isLive).toBe(false);
    expect(primaryActionLabel(state.action)).toBe('Send for review');
  });

  it('confirms a submission is with Stayo, which the page never used to say', () => {
    const state = listingLifecycle(
      { draft: draft({ status: 'PENDING_REVIEW', submitted_at: '2026-08-19T14:10:00Z' }), published: null, last_rejection: null },
      false,
    );
    expect(state.key).toBe('IN_REVIEW');
    expect(state.withStayo).toBe(true);
    expect(state.detail).toContain('Sent to Stayo');
    expect(primaryActionLabel(state.action)).toBe('Withdraw from review');
  });

  it('keeps the live version visible while a new one is in review', () => {
    // The exact state the live database was in: v3 APPROVED, v4 PENDING.
    const state = listingLifecycle(
      { draft: draft({ status: 'PENDING_REVIEW', version: 4 }), published: published(), last_rejection: null },
      false,
    );
    expect(state.key).toBe('LIVE_IN_REVIEW');
    expect(state.isLive).toBe(true);
    expect(state.withStayo).toBe(true);
    expect(state.detail).toContain('v3 stays live');
  });

  it('reads as Live — not Draft — once approved with no open work', () => {
    // The old page derived its badge from draft.status alone, which is DRAFT
    // after approval, so a live listing announced itself as a draft.
    const state = listingLifecycle({ draft: draft(), published: published(), last_rejection: null }, false);
    expect(state.key).toBe('LIVE');
    expect(state.label).toBe('Live');
    expect(state.step).toBe(2);
    expect(primaryActionLabel(state.action)).toBeNull();
  });

  it('warns that unsent edits are not what the public sees', () => {
    const state = listingLifecycle({ draft: draft({ id: 'd1' }), published: published(), last_rejection: null }, false);
    expect(state.key).toBe('LIVE_EDITED');
    expect(state.detail).toContain('only after Stayo reviews them');
    expect(primaryActionLabel(state.action)).toBe('Send for review');
  });

  it('treats unsaved typing as unsent edits too', () => {
    const state = listingLifecycle({ draft: draft(), published: published(), last_rejection: null }, true);
    expect(state.key).toBe('LIVE_EDITED');
  });

  it('surfaces a rejection that has not been answered', () => {
    const state = listingLifecycle(
      { draft: draft({ version: 2 }), published: null, last_rejection: { version: 1, review_note: 'Photos are blurry', reviewed_at: '2026-08-16T18:09:00Z' } },
      false,
    );
    expect(state.key).toBe('CHANGES_REQUESTED');
    expect(primaryActionLabel(state.action)).toBe('Send updated version');
  });

  it('drops a rejection once a newer version has been approved', () => {
    const state = listingLifecycle(
      { draft: draft(), published: published({ version: 3 }), last_rejection: { version: 1, review_note: 'old', reviewed_at: null } },
      false,
    );
    expect(state.key).toBe('LIVE');
  });
});
