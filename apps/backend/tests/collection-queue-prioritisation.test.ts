import { describe, expect, it } from 'vitest';
import {
  assignBucket,
  scoreSignals,
  prioritise,
  sortQueue,
  daysBetween,
  DEFAULT_PRIORITY_CONFIG,
  BUCKETS,
  type CollectionSignals,
} from '@/lib/services/collection-queue/prioritisation';

/** Pure — no database. Runs under `npm run test:pure`. */

const TODAY = new Date('2026-08-05T10:00:00Z');
const daysAgo = (n: number) => new Date(Date.UTC(2026, 7, 5 - n));

function signals(overrides: Partial<CollectionSignals> = {}): CollectionSignals {
  return {
    outstanding: 8000,
    daysOverdue: 0,
    daysUntilDue: null,
    lastPaymentAt: daysAgo(30),
    lastReminderAt: null,
    reminderCount: 0,
    previousLatePayments: 0,
    ...overrides,
  };
}

describe('daysBetween', () => {
  it('ignores time of day', () => {
    expect(daysBetween(new Date('2026-08-01T23:00:00Z'), new Date('2026-08-02T01:00:00Z'))).toBe(1);
  });

  it('is negative for future dates', () => {
    expect(daysBetween(new Date('2026-08-10T00:00:00Z'), new Date('2026-08-05T00:00:00Z'))).toBe(-5);
  });
});

describe('assignBucket', () => {
  const bucket = (s: Partial<CollectionSignals>) => assignBucket(signals(s), DEFAULT_PRIORITY_CONFIG, TODAY);

  it('excludes anyone who owes nothing', () => {
    expect(bucket({ outstanding: 0, daysOverdue: 30 })).toBeNull();
  });

  it('puts overdue tenants in needs-immediate-attention', () => {
    expect(bucket({ daysOverdue: 12 })).toBe('NEEDS_ATTENTION');
  });

  it('puts today\'s dues in due-today', () => {
    expect(bucket({ daysUntilDue: 0 })).toBe('DUE_TODAY');
  });

  it('puts near-future dues in due-soon', () => {
    expect(bucket({ daysUntilDue: 5 })).toBe('DUE_SOON');
  });

  it('excludes dues beyond the due-soon window — not today\'s work', () => {
    expect(bucket({ daysUntilDue: 30 })).toBeNull();
  });

  it('includes the last day of the due-soon window', () => {
    expect(bucket({ daysUntilDue: 7 })).toBe('DUE_SOON');
    expect(bucket({ daysUntilDue: 8 })).toBeNull();
  });

  describe('reminder cooldown', () => {
    it('moves a just-reminded, mildly-overdue tenant out of the top bucket', () => {
      // Chasing again the day after you already chased is noise, not work.
      expect(bucket({ daysOverdue: 3, lastReminderAt: daysAgo(0) })).toBe('AWAITING_REMINDER');
      expect(bucket({ daysOverdue: 3, lastReminderAt: daysAgo(1) })).toBe('AWAITING_REMINDER');
    });

    it('returns them to the top once the cooldown lapses', () => {
      expect(bucket({ daysOverdue: 3, lastReminderAt: daysAgo(2) })).toBe('NEEDS_ATTENTION');
      expect(bucket({ daysOverdue: 3, lastReminderAt: daysAgo(9) })).toBe('NEEDS_ATTENTION');
    });

    it('ignores a reminder dated in the future rather than hiding the tenant', () => {
      const future = new Date(Date.UTC(2026, 7, 20));
      expect(bucket({ daysOverdue: 3, lastReminderAt: future })).toBe('NEEDS_ATTENTION');
    });

    it('STOPS deferring once the tenant is badly overdue — the reminder clearly is not working', () => {
      // Caught against live data: an 11-day-overdue tenant reminded yesterday
      // was being demoted below a 12-day one, and 7 of 10 tenants fell into
      // "waiting" while ₹59,000 sat uncollected.
      expect(bucket({ daysOverdue: 8, lastReminderAt: daysAgo(0) })).toBe('NEEDS_ATTENTION');
      expect(bucket({ daysOverdue: 11, lastReminderAt: daysAgo(0) })).toBe('NEEDS_ATTENTION');
    });

    it('applies the severity override exactly at the boundary', () => {
      expect(bucket({ daysOverdue: 7, lastReminderAt: daysAgo(0) })).toBe('AWAITING_REMINDER');
      expect(bucket({ daysOverdue: 8, lastReminderAt: daysAgo(0) })).toBe('NEEDS_ATTENTION');
    });

    it('applies to not-yet-overdue tenants too', () => {
      expect(bucket({ daysUntilDue: 0, lastReminderAt: daysAgo(0) })).toBe('AWAITING_REMINDER');
    });
  });

  it('respects a custom cooldown and window', () => {
    const cfg = { reminderCooldownDays: 5, dueSoonWindowDays: 2, reminderCooldownMaxOverdueDays: 7 };
    expect(assignBucket(signals({ daysOverdue: 3, lastReminderAt: daysAgo(4) }), cfg, TODAY)).toBe('AWAITING_REMINDER');
    expect(assignBucket(signals({ daysUntilDue: 3 }), cfg, TODAY)).toBeNull();
  });
});

describe('scoreSignals — every point is attributable', () => {
  it('attributes days overdue', () => {
    const { factors } = scoreSignals(signals({ daysOverdue: 12 }));
    const f = factors.find((x) => x.id === 'overdue');
    expect(f?.points).toBe(24);
    expect(f?.label).toBe('12 days overdue');
  });

  it('says "1 day" not "1 days"', () => {
    const { factors } = scoreSignals(signals({ daysOverdue: 1 }));
    expect(factors.find((x) => x.id === 'overdue')?.label).toBe('1 day overdue');
  });

  it('caps the overdue contribution so amount can still decide', () => {
    const at60 = scoreSignals(signals({ daysOverdue: 60, outstanding: 0 })).score;
    const at365 = scoreSignals(signals({ daysOverdue: 365, outstanding: 0 })).score;
    expect(at60).toBe(at365);
  });

  it('attributes the outstanding amount in owner language', () => {
    const { factors } = scoreSignals(signals({ outstanding: 8000 }));
    const f = factors.find((x) => x.id === 'amount');
    expect(f?.points).toBe(8);
    expect(f?.label).toBe('₹8,000 outstanding');
  });

  it('caps the amount so one huge balance cannot bury every overdue tenant', () => {
    expect(scoreSignals(signals({ outstanding: 50_000, daysOverdue: 0 })).score).toBe(
      scoreSignals(signals({ outstanding: 5_000_000, daysOverdue: 0 })).score,
    );
  });

  it('attributes repeat lateness', () => {
    const { factors } = scoreSignals(signals({ previousLatePayments: 2 }));
    const f = factors.find((x) => x.id === 'repeat');
    expect(f?.points).toBe(20);
    expect(f?.label).toBe('Paid late 2 times before');
  });

  it('caps repeat lateness', () => {
    expect(scoreSignals(signals({ previousLatePayments: 99 })).factors.find((f) => f.id === 'repeat')?.points).toBe(30);
  });

  it('flags a tenant who has never paid', () => {
    const { factors } = scoreSignals(signals({ lastPaymentAt: null }));
    expect(factors.find((x) => x.id === 'never_paid')?.label).toBe('Has never paid');
  });

  it('does not flag never-paid when a payment exists', () => {
    expect(scoreSignals(signals({ lastPaymentAt: daysAgo(5) })).factors.some((f) => f.id === 'never_paid')).toBe(false);
  });

  it('flags ignored reminders only from the third one', () => {
    expect(scoreSignals(signals({ reminderCount: 2 })).factors.some((f) => f.id === 'ignored_reminders')).toBe(false);
    const { factors } = scoreSignals(signals({ reminderCount: 3 }));
    expect(factors.find((f) => f.id === 'ignored_reminders')?.label).toBe('3 reminders, still unpaid');
  });

  it('score always equals the sum of its factors — nothing hidden', () => {
    const s = signals({ daysOverdue: 10, outstanding: 12_000, previousLatePayments: 1, lastPaymentAt: null, reminderCount: 4 });
    const { score, factors } = scoreSignals(s);
    expect(score).toBe(factors.reduce((n, f) => n + f.points, 0));
    expect(factors.length).toBe(5);
  });

  it('produces no factors and a zero score for a clean tenant', () => {
    const { score, factors } = scoreSignals(signals({ outstanding: 0, lastPaymentAt: daysAgo(1) }));
    expect(score).toBe(0);
    expect(factors).toEqual([]);
  });
});

describe('scoreSignals — ordering intent', () => {
  it('ranks longer overdue above shorter, all else equal', () => {
    expect(scoreSignals(signals({ daysOverdue: 30 })).score).toBeGreaterThan(
      scoreSignals(signals({ daysOverdue: 3 })).score,
    );
  });

  it('ranks a bigger balance above a smaller one at equal lateness', () => {
    expect(scoreSignals(signals({ daysOverdue: 5, outstanding: 20_000 })).score).toBeGreaterThan(
      scoreSignals(signals({ daysOverdue: 5, outstanding: 2_000 })).score,
    );
  });

  it('ranks a repeat defaulter above a first-time late payer', () => {
    expect(scoreSignals(signals({ daysOverdue: 5, previousLatePayments: 3 })).score).toBeGreaterThan(
      scoreSignals(signals({ daysOverdue: 5, previousLatePayments: 0 })).score,
    );
  });
});

describe('prioritise', () => {
  it('returns null for anyone not in today\'s queue', () => {
    expect(prioritise(signals({ outstanding: 0 }), TODAY)).toBeNull();
  });

  it('carries a null recommendation slot for the future engine', () => {
    const item = prioritise(signals({ daysOverdue: 4 }), TODAY);
    expect(item?.recommendation).toBeNull();
    expect(item).toHaveProperty('recommendation');
  });
});

describe('sortQueue', () => {
  const row = (bucket: keyof typeof BUCKETS, score: number, tenantName: string) => ({ bucket, score, tenantName });

  it('orders buckets before scores', () => {
    const sorted = sortQueue([
      row('DUE_SOON', 999, 'Soon'),
      row('NEEDS_ATTENTION', 1, 'Urgent'),
      row('DUE_TODAY', 500, 'Today'),
    ]);
    expect(sorted.map((r) => r.tenantName)).toEqual(['Urgent', 'Today', 'Soon']);
  });

  it('puts waiting-after-reminder below due-today but above due-soon', () => {
    const sorted = sortQueue([
      row('DUE_SOON', 10, 'Soon'),
      row('AWAITING_REMINDER', 10, 'Waiting'),
      row('DUE_TODAY', 10, 'Today'),
    ]);
    expect(sorted.map((r) => r.tenantName)).toEqual(['Today', 'Waiting', 'Soon']);
  });

  it('orders by score within a bucket', () => {
    const sorted = sortQueue([
      row('NEEDS_ATTENTION', 10, 'Low'),
      row('NEEDS_ATTENTION', 90, 'High'),
    ]);
    expect(sorted.map((r) => r.tenantName)).toEqual(['High', 'Low']);
  });

  it('breaks ties by name so the queue does not reshuffle between refreshes', () => {
    const sorted = sortQueue([
      row('NEEDS_ATTENTION', 50, 'Zoya'),
      row('NEEDS_ATTENTION', 50, 'Amit'),
    ]);
    expect(sorted.map((r) => r.tenantName)).toEqual(['Amit', 'Zoya']);
  });

  it('does not mutate the input', () => {
    const input = [row('DUE_SOON', 1, 'a'), row('NEEDS_ATTENTION', 1, 'b')];
    sortQueue(input);
    expect(input[0].tenantName).toBe('a');
  });
});
