import { describe, expect, it } from 'vitest';
import { attentionSummary, controlFor, groupAction, importHoldReason } from './issueCopy';
import type { IssueGroup, RowIssue } from './reviewQueue';

const issue = (over: Partial<RowIssue> = {}): RowIssue => ({
  code: 'PHONE_INVALID',
  severity: 'BLOCKER',
  row: 2,
  title: 'title',
  detail: 'detail',
  field: 'phone',
  fix: { kind: 'EDIT_FIELD' },
  ...over,
});

// A plain acknowledgement. Back-rent codes have their own wording, tested
// below, because agreeing to them creates dues.
const group = (over: Partial<IssueGroup> = {}): IssueGroup => ({
  code: 'SOME_NOTICE',
  severity: 'NEEDS_CHOICE',
  title: 'title',
  detail: 'detail',
  rows: [2, 3],
  count: 2,
  canApplyToAll: true,
  ...over,
});

describe('controlFor', () => {
  it('gives a room picker its options from the backend, not a guess', () => {
    const control = controlFor(issue({ fix: { kind: 'PICK_ROOM', options: ['101', '102'] } }));
    expect(control.kind).toBe('room');
    expect(control.options).toEqual(['101', '102']);
  });

  it('knows which field an edit touches', () => {
    expect(controlFor(issue()).field).toBe('phone');
  });

  it('offers a date picker for an unreadable date', () => {
    expect(controlFor(issue({ fix: { kind: 'PICK_DATE' }, field: 'joining_date' })).kind).toBe('date');
  });

  it('links out for someone already on Stayo, rather than pretending it is editable', () => {
    expect(controlFor(issue({ fix: { kind: 'OPEN_TENANT' } })).kind).toBe('link');
  });

  it('falls back to a text edit for a fix kind it has never seen', () => {
    expect(controlFor(issue({ fix: { kind: 'SOMETHING_NEW' } })).kind).toBe('text');
  });
});

describe('groupAction', () => {
  it('names the count, so the owner knows what one tap settles', () => {
    expect(groupAction(group({ count: 32, rows: [2, 3] }))!.label).toBe('Understood — apply to all 32');
  });

  it('says the decision is not final', () => {
    expect(groupAction(group())!.note).toContain('still change any of them');
  });

  it('offers nothing when the fix cannot be applied in bulk', () => {
    expect(groupAction(group({ canApplyToAll: false }))).toBeNull();
  });

  it('uses Indian digit grouping for a big import', () => {
    expect(groupAction(group({ count: 100000 }))!.label).toContain('1,00,000');
  });
});

describe('attentionSummary', () => {
  it('leads with what is ready', () => {
    expect(attentionSummary({ ready: 38, needsYou: 2, duplicates: 1 })).toBe('38 ready · 2 need you · 1 already here');
  });

  it('says nothing about buckets that are empty', () => {
    expect(attentionSummary({ ready: 38, needsYou: 0, duplicates: 0 })).toBe('38 ready');
  });

  it('is honest when there is nothing', () => {
    expect(attentionSummary({ ready: 0, needsYou: 0, duplicates: 0 })).toBe('Nothing to import yet');
  });
});

describe('agreeing to back-rent', () => {
  const consent = {
    code: 'RENT_BACKDATED',
    severity: 'NEEDS_CHOICE',
    row: 2,
    title: '',
    detail: '',
    fix: { kind: 'ACKNOWLEDGE' },
  } as any;

  /** "Got it" is right for a notice and wrong for money. */
  it('says what the button does', () => {
    expect(controlFor(consent).label).toBe('Yes, bill from their joining date');
  });

  it('leaves other acknowledgements alone', () => {
    expect(controlFor({ ...consent, code: 'SOMETHING_ELSE' }).label).toBe('Got it');
  });

  it('names the whole group decision in money terms', () => {
    const action = groupAction({
      code: 'RENT_BACKDATED',
      severity: 'NEEDS_CHOICE',
      title: '',
      detail: '',
      rows: [2, 3, 4],
      count: 3,
      canApplyToAll: true,
    });

    expect(action!.label).toBe('Yes, bill all 3 from their joining dates');
  });
});

describe('why Import is waiting', () => {
  /** A dead button with no reason is how the owner came to ask where to "configure" it. */
  it('says so when back-rent needs agreeing', () => {
    expect(importHoldReason({ blockers: 0, awaitingConsent: 1 })).toMatch(/already lives here/);
    expect(importHoldReason({ blockers: 0, awaitingConsent: 3 })).toMatch(/3 tenants/);
  });

  it('stays out of the way of the blocking-rows message', () => {
    expect(importHoldReason({ blockers: 2, awaitingConsent: 1 })).toBeNull();
  });

  it('says nothing when nothing is waiting', () => {
    expect(importHoldReason({ blockers: 0, awaitingConsent: 0 })).toBeNull();
  });
});
