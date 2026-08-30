import { describe, it, expect } from 'vitest';
import {
  MIN_ALERTS_QUERY_LENGTH,
  matchesTokens,
  normaliseQuery,
  searchAlerts,
  type AlertsLists,
} from './alertsSearch';

const lead = (over: Partial<AlertsLists['leads'][number]> = {}) => ({
  id: 'l1',
  student_name: 'Riya Sharma',
  student_phone: '+918008046952',
  source: 'DISCOVER',
  status: 'READY_TO_JOIN',
  hostel_id: 'h1',
  hostel: { id: 'h1', name: 'Sunrise Residency' },
  seeker_profile_id: null,
  ...over,
});

const LISTS: AlertsLists = {
  leads: [
    lead(),
    lead({
      id: 'l2',
      student_name: 'Arjun Rao',
      student_phone: '9845013001',
      status: 'NEW',
      hostel: { id: 'h2', name: 'Green Nest PG' },
    }),
  ],
  adminMessages: [
    { id: 'm1', title: 'Payout sent', body: 'Rs 18,500 reached your bank', time: '2026-08-01', read: false },
  ],
  renewals: [{ id: 'r1', name: 'Riya Sharma', detail: 'Agreement ends 30 Sep', days: 12, read: false }],
  requests: [{ id: 'q1', name: 'Kavya Menon', detail: 'Wants to change room', type: 'ROOM_CHANGE', status: 'RAISED', read: false }],
};

describe('normaliseQuery', () => {
  it('lowercases and splits on any whitespace', () => {
    expect(normaliseQuery('  Riya   SHARMA ')).toEqual(['riya', 'sharma']);
  });

  it('returns nothing for an empty or whitespace query', () => {
    expect(normaliseQuery('')).toEqual([]);
    expect(normaliseQuery('   ')).toEqual([]);
  });
});

describe('matchesTokens', () => {
  const hay = { text: ['Riya Sharma', 'Sunrise Residency'], phones: ['+918008046952'] };

  it('matches nothing-typed as everything', () => {
    expect(matchesTokens(hay, [])).toBe(true);
  });

  // The owner does not know which field holds what, so word order and field
  // boundaries must not matter.
  it('requires every word, but across any field and in any order', () => {
    expect(matchesTokens(hay, ['riya', 'sunrise'])).toBe(true);
    expect(matchesTokens(hay, ['sunrise', 'riya'])).toBe(true);
    expect(matchesTokens(hay, ['riya', 'kavya'])).toBe(false);
  });

  it('matches part of a phone without the country code', () => {
    expect(matchesTokens(hay, ['8046'])).toBe(true);
    expect(matchesTokens(hay, ['8008046952'])).toBe(true);
    expect(matchesTokens(hay, ['918008046952'])).toBe(true);
  });

  // "80" matches roughly every Indian mobile in the account, which is worse
  // than no result. Caught by these tests: the number used to sit in the text
  // haystack, where a plain substring check found it.
  it('does not treat one or two digits as a phone search', () => {
    expect(matchesTokens(hay, ['80'])).toBe(false);
    expect(matchesTokens(hay, ['8'])).toBe(false);
  });

  it('never matches digits against prose', () => {
    expect(matchesTokens({ text: ['Room 101 repainted'], phones: [] }, ['101'])).toBe(false);
  });

  // Joining fields with a separator stops false positives spanning the end of
  // one field and the start of the next.
  it('does not match across a field boundary', () => {
    expect(matchesTokens(hay, ['sharmasri'])).toBe(false);
  });

  it('is case-insensitive even when tokens are not pre-normalised', () => {
    expect(matchesTokens(hay, ['RIYA'])).toBe(true);
  });

  it('does not match a phone on a record that has none', () => {
    expect(matchesTokens({ text: ['Riya Sharma'], phones: [] }, ['8046'])).toBe(false);
  });
});

describe('searchAlerts', () => {
  it('passes every list through untouched when nothing is typed', () => {
    const result = searchAlerts('', LISTS);
    expect(result.active).toBe(false);
    expect(result.leads).toHaveLength(2);
    expect(result.renewals).toHaveLength(1);
  });

  it('stays inactive below the minimum length', () => {
    const short = 'r'.repeat(MIN_ALERTS_QUERY_LENGTH - 1);
    expect(searchAlerts(short, LISTS).active).toBe(false);
    expect(searchAlerts(short, LISTS).leads).toHaveLength(2);
  });

  it('filters every category at once', () => {
    const result = searchAlerts('riya', LISTS);
    expect(result.active).toBe(true);
    expect(result.leads.map((l) => l.id)).toEqual(['l1']);
    expect(result.renewals.map((r) => r.id)).toEqual(['r1']);
    expect(result.adminMessages).toHaveLength(0);
    expect(result.requests).toHaveLength(0);
    expect(result.total).toBe(2);
  });

  it('searches the label an owner actually reads, not the raw status', () => {
    expect(searchAlerts('ready to join', LISTS).leads.map((l) => l.id)).toEqual(['l1']);
    // The underlying value still works, but nobody types it.
    expect(searchAlerts('READY_TO_JOIN', LISTS).leads).toHaveLength(0);
  });

  it('finds a lead by hostel', () => {
    expect(searchAlerts('sunrise', LISTS).leads.map((l) => l.id)).toEqual(['l1']);
  });

  it('finds a lead by part of a phone number', () => {
    expect(searchAlerts('9845', LISTS).leads.map((l) => l.id)).toEqual(['l2']);
  });

  it('searches message bodies, not just titles', () => {
    expect(searchAlerts('bank', LISTS).adminMessages.map((m) => m.id)).toEqual(['m1']);
  });

  it('handles a lead with no phone and no hostel without throwing', () => {
    const lists = { ...LISTS, leads: [lead({ student_phone: null, hostel: undefined })] };
    expect(searchAlerts('riya', lists).leads).toHaveLength(1);
    expect(searchAlerts('8046', lists).leads).toHaveLength(0);
  });

  it('returns empty lists rather than everything when nothing matches', () => {
    const result = searchAlerts('zzzz', LISTS);
    expect(result.total).toBe(0);
    expect(result.leads).toHaveLength(0);
  });
});
