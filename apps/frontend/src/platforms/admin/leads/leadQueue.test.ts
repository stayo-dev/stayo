import { describe, it, expect } from 'vitest';
import {
  isActionable,
  canApprove,
  canReject,
  sortForQueue,
  ageLabel,
  isStale,
  stepIndex,
  partitionForBulkReject,
  STATUS_LABEL,
  type AdminLead,
} from './leadQueue';

const lead = (over: Partial<AdminLead> & { id: string }): AdminLead => ({
  id: over.id,
  name: over.name ?? `Owner ${over.id}`,
  hostel_name: over.hostel_name ?? 'Hostel',
  phone: over.phone ?? '9000000000',
  city: over.city ?? 'Hyderabad',
  status: over.status ?? 'NEW',
  created_at: over.created_at ?? '2026-08-07T00:00:00.000Z',
});

describe('actionability', () => {
  // APPROVED means "approved but the activation link failed to send" — it
  // needs a retry, not a fresh decision. Excluding it would strand those.
  it('treats NEW, UNDER_REVIEW and APPROVED as still needing an admin', () => {
    expect(isActionable('NEW')).toBe(true);
    expect(isActionable('UNDER_REVIEW')).toBe(true);
    expect(isActionable('APPROVED')).toBe(true);
  });

  it('treats everything downstream as not needing an admin', () => {
    for (const s of ['INVITE_SENT', 'OWNER_ACTIVATED', 'HOSTEL_CREATED', 'LIVE', 'LOST']) {
      expect(isActionable(s)).toBe(false);
    }
  });

  // This is the dashboard bug in miniature: offering Approve on an
  // INVITE_SENT lead throws INVALID_TRANSITION on the server.
  it('mirrors the server: approve is offered only where it can succeed', () => {
    expect(canApprove('INVITE_SENT')).toBe(false);
    expect(canApprove('LOST')).toBe(false);
    expect(canApprove('APPROVED')).toBe(true);
  });

  // Reject is narrower than approve — once a link is out, declining is a
  // cancellation, not a status write.
  it('allows reject only before an activation link exists', () => {
    expect(canReject('NEW')).toBe(true);
    expect(canReject('UNDER_REVIEW')).toBe(true);
    expect(canReject('APPROVED')).toBe(false);
    expect(canReject('INVITE_SENT')).toBe(false);
  });

  it('never shows a raw enum value as a label', () => {
    for (const s of ['NEW', 'UNDER_REVIEW', 'APPROVED', 'INVITE_SENT', 'OWNER_ACTIVATED', 'HOSTEL_CREATED', 'LIVE', 'LOST']) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_LABEL[s]).not.toBe(s);
    }
  });
});

describe('sortForQueue', () => {
  it('puts everything needing a decision above everything that does not', () => {
    const sorted = sortForQueue([
      lead({ id: 'live', status: 'LIVE', created_at: '2026-08-07T10:00:00.000Z' }),
      lead({ id: 'new', status: 'NEW', created_at: '2026-08-01T10:00:00.000Z' }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(['new', 'live']);
  });

  // At 100/day, newest-first means whoever has waited longest is never
  // reached — they sink further every time someone new signs up.
  it('works the actionable ones oldest-first', () => {
    const sorted = sortForQueue([
      lead({ id: 'recent', status: 'NEW', created_at: '2026-08-07T10:00:00.000Z' }),
      lead({ id: 'old', status: 'NEW', created_at: '2026-08-01T10:00:00.000Z' }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(['old', 'recent']);
  });

  it('shows settled leads most-recent-first, since those are for looking up', () => {
    const sorted = sortForQueue([
      lead({ id: 'oldLive', status: 'LIVE', created_at: '2026-08-01T10:00:00.000Z' }),
      lead({ id: 'newLive', status: 'LIVE', created_at: '2026-08-07T10:00:00.000Z' }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(['newLive', 'oldLive']);
  });

  it('does not mutate the input', () => {
    const input = [lead({ id: 'a', status: 'LIVE' }), lead({ id: 'b', status: 'NEW' })];
    sortForQueue(input);
    expect(input.map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('ageLabel and isStale', () => {
  const now = new Date('2026-08-07T12:00:00.000Z').getTime();

  it('describes the wait compactly enough for a dense row', () => {
    expect(ageLabel('2026-08-07T11:59:30.000Z', now)).toBe('just now');
    expect(ageLabel('2026-08-07T11:30:00.000Z', now)).toBe('30m');
    expect(ageLabel('2026-08-07T09:00:00.000Z', now)).toBe('3h');
    expect(ageLabel('2026-08-04T12:00:00.000Z', now)).toBe('3d');
  });

  it('returns nothing for an unparseable date', () => {
    expect(ageLabel('nope', now)).toBe('');
  });

  it('flags a lead left undecided for over a day', () => {
    expect(isStale(lead({ id: 'a', status: 'NEW', created_at: '2026-08-05T12:00:00.000Z' }), now)).toBe(true);
    expect(isStale(lead({ id: 'b', status: 'NEW', created_at: '2026-08-07T06:00:00.000Z' }), now)).toBe(false);
  });

  // An old LIVE lead is not a backlog item — flagging it would train the
  // reviewer to ignore the flag.
  it('never flags a lead that needs no decision, however old', () => {
    expect(isStale(lead({ id: 'c', status: 'LIVE', created_at: '2020-01-01T00:00:00.000Z' }), now)).toBe(false);
    expect(isStale(lead({ id: 'd', status: 'LOST', created_at: '2020-01-01T00:00:00.000Z' }), now)).toBe(false);
  });
});

describe('stepIndex', () => {
  it('clamps at both ends so keyboard navigation cannot fall off the list', () => {
    expect(stepIndex(3, 0, -1)).toBe(0);
    expect(stepIndex(3, 2, 1)).toBe(2);
    expect(stepIndex(3, 1, 1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe('partitionForBulkReject', () => {
  const leads = [
    lead({ id: 'a', status: 'NEW' }),
    lead({ id: 'b', status: 'INVITE_SENT' }),
    lead({ id: 'c', status: 'UNDER_REVIEW' }),
  ];

  // A bulk action that silently skips part of the selection is worse than one
  // that says so — the admin would believe all twelve were rejected.
  it('separates what can be rejected from what will be skipped', () => {
    const { eligible, skipped } = partitionForBulkReject(leads, new Set(['a', 'b', 'c']));
    expect(eligible.map((l) => l.id)).toEqual(['a', 'c']);
    expect(skipped.map((l) => l.id)).toEqual(['b']);
  });

  it('ignores leads that were not selected', () => {
    const { eligible } = partitionForBulkReject(leads, new Set(['a']));
    expect(eligible.map((l) => l.id)).toEqual(['a']);
  });

  it('handles an empty selection', () => {
    const { eligible, skipped } = partitionForBulkReject(leads, new Set());
    expect(eligible).toEqual([]);
    expect(skipped).toEqual([]);
  });
});
