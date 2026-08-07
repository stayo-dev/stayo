import { describe, it, expect } from 'vitest';
import {
  groupByOwner,
  waitingLabel,
  isOverdue,
  nextSelection,
  stepSelection,
  previewKind,
  type AdminOwnerDocument,
} from './documentQueue';

const doc = (over: Partial<AdminOwnerDocument> & { id: string; ownerId: string }): AdminOwnerDocument => ({
  id: over.id,
  doc_type: over.doc_type ?? 'AADHAAR',
  file_url: over.file_url ?? 'https://example.test/a.png',
  mime_type: over.mime_type ?? 'image/png',
  status: over.status ?? 'PENDING',
  uploaded_at: over.uploaded_at ?? '2026-08-07T00:00:00.000Z',
  reviewed_at: null,
  review_note: null,
  profile: { id: over.ownerId, name: `Owner ${over.ownerId}`, phone: '9000000000', email: null },
});

describe('groupByOwner', () => {
  // The owner is the unit of review: judging Aadhaar and PAN apart means
  // opening the same person twice and losing the cross-check between names.
  it('gathers every document from one owner into a single group', () => {
    const groups = groupByOwner([
      doc({ id: '1', ownerId: 'a', doc_type: 'AADHAAR' }),
      doc({ id: '2', ownerId: 'a', doc_type: 'PAN' }),
      doc({ id: '3', ownerId: 'b', doc_type: 'AADHAAR' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.ownerId === 'a')!.documents).toHaveLength(2);
  });

  // Newest-first would push whoever has waited longest further down every
  // time someone new uploads.
  it('puts whoever has waited longest first', () => {
    const groups = groupByOwner([
      doc({ id: '1', ownerId: 'new', uploaded_at: '2026-08-07T10:00:00.000Z' }),
      doc({ id: '2', ownerId: 'old', uploaded_at: '2026-08-01T10:00:00.000Z' }),
    ]);
    expect(groups[0].ownerId).toBe('old');
  });

  it('dates a group by its oldest upload, not its newest', () => {
    const groups = groupByOwner([
      doc({ id: '1', ownerId: 'a', uploaded_at: '2026-08-07T10:00:00.000Z' }),
      doc({ id: '2', ownerId: 'a', doc_type: 'PAN', uploaded_at: '2026-08-02T10:00:00.000Z' }),
    ]);
    expect(groups[0].waitingSince).toBe('2026-08-02T10:00:00.000Z');
  });

  it('orders identity documents before the profile photo', () => {
    const groups = groupByOwner([
      doc({ id: '1', ownerId: 'a', doc_type: 'PHOTO' }),
      doc({ id: '2', ownerId: 'a', doc_type: 'PAN' }),
      doc({ id: '3', ownerId: 'a', doc_type: 'AADHAAR' }),
    ]);
    expect(groups[0].documents.map((d) => d.doc_type)).toEqual(['AADHAAR', 'PAN', 'PHOTO']);
  });

  it('handles an empty queue', () => {
    expect(groupByOwner([])).toEqual([]);
  });
});

describe('waitingLabel', () => {
  const base = new Date('2026-08-07T12:00:00.000Z').getTime();

  it('describes the wait in the largest sensible unit', () => {
    expect(waitingLabel('2026-08-07T11:59:30.000Z', base)).toBe('just now');
    expect(waitingLabel('2026-08-07T11:30:00.000Z', base)).toBe('30m waiting');
    expect(waitingLabel('2026-08-07T09:00:00.000Z', base)).toBe('3h waiting');
    expect(waitingLabel('2026-08-05T12:00:00.000Z', base)).toBe('2d waiting');
  });

  it('returns nothing rather than NaN for an unparseable date', () => {
    expect(waitingLabel('not a date', base)).toBe('');
  });
});

describe('isOverdue', () => {
  const base = new Date('2026-08-07T12:00:00.000Z').getTime();

  // An owner cannot go live until this is reviewed, so an ageing queue costs
  // signups — it has to be visible in the list.
  it('flags anything waiting more than a day', () => {
    expect(isOverdue('2026-08-06T11:00:00.000Z', base)).toBe(true);
    expect(isOverdue('2026-08-07T06:00:00.000Z', base)).toBe(false);
  });

  it('does not flag an unparseable date', () => {
    expect(isOverdue('nonsense', base)).toBe(false);
  });
});

describe('selection after acting', () => {
  const groups = groupByOwner([
    doc({ id: '1', ownerId: 'a', uploaded_at: '2026-08-01T00:00:00.000Z' }),
    doc({ id: '2', ownerId: 'b', uploaded_at: '2026-08-02T00:00:00.000Z' }),
  ]);

  // The list shrinks under the reviewer as items clear, so holding position
  // means the next item slides into the slot they were already looking at.
  it('holds position so the next item slides into place', () => {
    expect(nextSelection(groups, 0)?.ownerId).toBe('a');
  });

  it('falls back to the last item when the queue shrinks past the index', () => {
    expect(nextSelection(groups, 9)?.ownerId).toBe('b');
  });

  it('returns null on an empty queue', () => {
    expect(nextSelection([], 0)).toBeNull();
  });

  it('clamps keyboard stepping to the ends of the list', () => {
    expect(stepSelection(groups, 0, -1)).toBe(0);
    expect(stepSelection(groups, 1, 1)).toBe(1);
    expect(stepSelection(groups, 0, 1)).toBe(1);
    expect(stepSelection([], 0, 1)).toBe(0);
  });
});

describe('previewKind', () => {
  // Showing the document inline is the whole point — a link that opens a new
  // tab breaks the review loop on every single item.
  it('recognises what can be shown inline', () => {
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('image/jpeg')).toBe('image');
    expect(previewKind('application/pdf')).toBe('pdf');
  });

  it('is case-insensitive', () => {
    expect(previewKind('IMAGE/PNG')).toBe('image');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(previewKind('application/zip')).toBe('unknown');
    expect(previewKind('')).toBe('unknown');
  });
});
