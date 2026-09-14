import { describe, it, expect } from 'vitest';
import {
  groupActivityEvents,
  istDayKey,
  istTimeLabel,
  actorLabel,
  categoryTone,
} from './groupActivityEvents';
import type { ActivityEvent } from './api';

const event = (id: string, timestamp: string, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id,
  category: 'Payments',
  title: `Event ${id}`,
  subtitle: '',
  timestamp,
  badgeColor: 'emerald',
  actor: { name: 'Owner', email: '' },
  metadata: {},
  ...over,
});

// 2026-09-14, 12:00 IST.
const NOW = new Date('2026-09-14T06:30:00Z');

describe('istDayKey', () => {
  it('files a late-evening UTC timestamp under the next IST day', () => {
    // 2026-09-13 20:00 UTC is 2026-09-14 01:30 IST. A browser set to UTC
    // would call this "yesterday"; in the hostel's own timezone it is today.
    expect(istDayKey('2026-09-13T20:00:00Z')).toBe('2026-09-14');
  });

  it('files an early-morning UTC timestamp under the same IST day', () => {
    expect(istDayKey('2026-09-14T00:30:00Z')).toBe('2026-09-14');
  });

  it('does not roll over before IST midnight', () => {
    // 18:29 UTC is 23:59 IST — still the 13th.
    expect(istDayKey('2026-09-13T18:29:00Z')).toBe('2026-09-13');
    // 18:30 UTC is 00:00 IST on the 14th.
    expect(istDayKey('2026-09-13T18:30:00Z')).toBe('2026-09-14');
  });

  it('returns an empty key for an unreadable timestamp', () => {
    expect(istDayKey('not a date')).toBe('');
  });
});

describe('istTimeLabel', () => {
  it('renders IST wall-clock time, not the runtime timezone', () => {
    expect(istTimeLabel('2026-09-14T08:44:00Z')).toBe('2:14 pm');
  });

  it('is empty rather than wrong for an unreadable timestamp', () => {
    expect(istTimeLabel('nonsense')).toBe('');
  });
});

describe('groupActivityEvents', () => {
  it('labels the reference day Today and the one before Yesterday', () => {
    const groups = groupActivityEvents(
      [event('a', '2026-09-14T05:00:00Z'), event('b', '2026-09-13T05:00:00Z')],
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
  });

  it('dates older days, without a year inside the same year', () => {
    const groups = groupActivityEvents([event('a', '2026-09-02T05:00:00Z')], NOW);
    // `Sept`, not `Sep` — Indian English abbreviates September with four
    // letters, and every other month with three. Asserted rather than worked
    // around so nobody "fixes" the locale later: the rest of the app formats
    // dates the same way, and matching it matters more than the extra glyph.
    expect(groups[0].label).toBe('2 Sept');
  });

  it('uses three-letter abbreviations for every other month', () => {
    const groups = groupActivityEvents([event('a', '2026-08-02T05:00:00Z')], NOW);
    expect(groups[0].label).toBe('2 Aug');
  });

  it('shows the year once it differs', () => {
    const groups = groupActivityEvents([event('a', '2025-12-02T05:00:00Z')], NOW);
    expect(groups[0].label).toBe('2 Dec 2025');
  });

  it('orders days newest first and events newest first within a day', () => {
    const groups = groupActivityEvents(
      [
        event('older-day', '2026-09-12T05:00:00Z'),
        event('today-early', '2026-09-14T03:00:00Z'),
        event('today-late', '2026-09-14T05:00:00Z'),
      ],
      NOW,
    );

    expect(groups.map((g) => g.key)).toEqual(['2026-09-14', '2026-09-12']);
    expect(groups[0].events.map((e) => e.id)).toEqual(['today-late', 'today-early']);
  });

  it('groups by IST day, so a post-midnight-IST event joins the right day', () => {
    const groups = groupActivityEvents(
      [
        // 01:30 IST on the 14th.
        event('after-midnight', '2026-09-13T20:00:00Z'),
        // 14:00 IST on the 14th.
        event('afternoon', '2026-09-14T08:30:00Z'),
      ],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].events.map((e) => e.id)).toEqual(['afternoon', 'after-midnight']);
  });

  it('returns nothing for an empty feed rather than an empty Today group', () => {
    expect(groupActivityEvents([], NOW)).toEqual([]);
  });

  it('drops an event whose timestamp cannot be read', () => {
    const groups = groupActivityEvents(
      [event('good', '2026-09-14T05:00:00Z'), event('bad', 'not a date')],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].events.map((e) => e.id)).toEqual(['good']);
  });
});

describe('actorLabel', () => {
  it('calls the owner You', () => {
    expect(actorLabel({ name: 'Owner' })).toBe('You');
  });

  it('keeps staff distinct from the owner', () => {
    expect(actorLabel({ name: 'Staff' })).toBe('Staff');
  });

  it('falls back to System when there is no actor', () => {
    expect(actorLabel(undefined)).toBe('System');
    expect(actorLabel({ name: '  ' })).toBe('System');
  });
});

describe('categoryTone', () => {
  it('reads money in and money out differently', () => {
    expect(categoryTone('Payments')).toBe('success');
    expect(categoryTone('Expenses')).toBe('destructive');
  });

  it('falls back for a category the server adds later', () => {
    expect(categoryTone('Something New')).toBe('muted');
  });
});
