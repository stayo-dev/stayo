import { describe, expect, it } from 'vitest';
import { alertKind, bucketFor, groupAlerts, shortAge, sortAlerts, unreadCount, type AlertRow } from './alerts';

const NOW = new Date('2026-08-26T12:00:00Z');
const row = (over: Partial<AlertRow>): AlertRow => ({
  id: 'a', title: 't', message: 'm', type: 'marketing', is_read: false,
  created_at: NOW.toISOString(), ...over,
});

describe('what kind of alert this is', () => {
  it('maps the types the product actually writes', () => {
    // Every one of these exists in the live table today.
    expect(alertKind('move_out')).toBe('STAY');
    expect(alertKind('marketing')).toBe('UPDATE');
    expect(alertKind('lead')).toBe('STAY');
    expect(alertKind('food_poll_opened')).toBe('FOOD');
    expect(alertKind('platform_broadcast')).toBe('UPDATE');
  });

  it('renders an unknown type instead of failing on it', () => {
    // `type` is a free string written by several services.
    expect(alertKind('something_new_next_month')).toBe('UPDATE');
    expect(alertKind('')).toBe('UPDATE');
  });

  it('ignores case', () => {
    expect(alertKind('MOVE_OUT')).toBe('STAY');
  });
});

describe('ordering', () => {
  it('is newest first, and does not float unread to the top', () => {
    // A feed that reorders as you read it loses your place.
    const rows = [
      row({ id: 'old', created_at: '2026-08-20T10:00:00Z', is_read: false }),
      row({ id: 'new', created_at: '2026-08-26T10:00:00Z', is_read: true }),
    ];
    expect(sortAlerts(rows).map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('does not mutate what it was given', () => {
    const rows = [row({ id: 'a', created_at: '2026-08-20T10:00:00Z' }), row({ id: 'b' })];
    sortAlerts(rows);
    expect(rows[0].id).toBe('a');
  });
});

describe('counting what is unread', () => {
  it('counts only unread', () => {
    expect(unreadCount([row({ is_read: false }), row({ is_read: true }), row({ is_read: false })])).toBe(2);
  });

  it('survives nothing at all', () => {
    expect(unreadCount([])).toBe(0);
    expect(unreadCount(null)).toBe(0);
    expect(unreadCount(undefined)).toBe(0);
  });
});

/**
 * Buckets are local-day based, which is what a reader means by "yesterday".
 * These dates are therefore built by local-day arithmetic rather than written
 * as UTC strings — in IST, `2026-08-25T23:00:00Z` is *today*, and hardcoding
 * it tests the runner's timezone rather than the function.
 */
const daysBefore = (n: number, hour = 9) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

describe('day buckets', () => {
  it('separates today, yesterday and this week', () => {
    expect(bucketFor(daysBefore(0), NOW)).toBe('Today');
    expect(bucketFor(daysBefore(1), NOW)).toBe('Yesterday');
    expect(bucketFor(daysBefore(4), NOW)).toBe('This week');
  });

  it('collapses anything past a week', () => {
    // Thirty date headings is not a feed, it is a calendar.
    expect(bucketFor(daysBefore(56), NOW)).toBe('Earlier');
  });

  it('does not crash on a malformed date', () => {
    expect(bucketFor('not a date', NOW)).toBe('Earlier');
  });

  it('omits empty buckets rather than rendering them blank', () => {
    const groups = groupAlerts([
      row({ id: 'a', created_at: daysBefore(0) }),
      row({ id: 'b', created_at: daysBefore(56) }),
    ], NOW);
    expect(groups.map((g) => g.bucket)).toEqual(['Today', 'Earlier']);
  });

  it('keeps the fixed bucket order regardless of input order', () => {
    const groups = groupAlerts([
      row({ id: 'old', created_at: daysBefore(56) }),
      row({ id: 'now', created_at: daysBefore(0) }),
    ], NOW);
    expect(groups[0].bucket).toBe('Today');
  });
});

describe('age', () => {
  it('reads as an age, not a timestamp', () => {
    expect(shortAge('2026-08-26T11:59:30Z', NOW)).toBe('now');
    expect(shortAge('2026-08-26T11:30:00Z', NOW)).toBe('30m');
    expect(shortAge('2026-08-26T09:00:00Z', NOW)).toBe('3h');
    expect(shortAge('2026-08-24T12:00:00Z', NOW)).toBe('2d');
    expect(shortAge('2026-08-05T12:00:00Z', NOW)).toBe('3w');
  });

  it('never renders a negative age from clock skew', () => {
    expect(shortAge('2026-08-26T12:05:00Z', NOW)).toBe('now');
  });

  it('says nothing for a malformed date', () => {
    expect(shortAge('nonsense', NOW)).toBe('');
  });
});
