import { describe, expect, it } from 'vitest';
import {
  typicalDayOfMonth,
  isDueAround,
  recordedThisCycle,
  relativeDay,
  summaryLine,
  scoreMemory,
  buildMemoryEntry,
  sortMemory,
  reusePayload,
  DEFAULT_MEMORY_CONFIG,
  type MemoryFacts,
} from '@/lib/services/expenses/expense-memory';

/** Pure — no database. Runs under `npm run test:pure`. */

const TODAY = new Date('2026-08-05T09:00:00Z');
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString();

function facts(overrides: Partial<MemoryFacts> = {}): MemoryFacts {
  return {
    kind: 'TITLE',
    key: 'Rice purchase',
    occurrences: 6,
    totalSpent: 48000,
    lastAmount: 8200,
    averageAmount: 8000,
    highestAmount: 8600,
    lastDate: iso(2026, 7, 5),
    daysOfMonth: [5, 5, 6, 4, 5, 5],
    category: 'Food & Groceries',
    vendorName: 'Sri Rice Traders',
    paymentMethod: 'UPI',
    notes: '50kg bag',
    isRecurring: true,
    recurringFrequency: 'monthly',
    receiptCount: 4,
    hostelCount: 2,
    ...overrides,
  };
}

describe('typicalDayOfMonth', () => {
  it('finds the usual day from a consistent history', () => {
    expect(typicalDayOfMonth([5, 5, 6, 4, 5, 5])).toBe(5);
  });

  it('uses the median so one mistimed entry cannot drag it', () => {
    // A mean would land near 9; the real pattern is the 5th.
    expect(typicalDayOfMonth([5, 5, 5, 5, 28])).toBe(5);
  });

  it('refuses to invent a pattern from too few occurrences', () => {
    expect(typicalDayOfMonth([5, 5])).toBeNull();
  });

  it('refuses when occurrences are genuinely scattered', () => {
    // A wrong nudge is worse than no nudge.
    expect(typicalDayOfMonth([1, 9, 17, 24, 28])).toBeNull();
  });

  it('ignores impossible day values', () => {
    expect(typicalDayOfMonth([0, 45, -3])).toBeNull();
  });
});

describe('isDueAround', () => {
  it('is true within tolerance of the typical day', () => {
    expect(isDueAround(5, TODAY)).toBe(true); // today is the 5th
    expect(isDueAround(8, TODAY)).toBe(true); // 3 days out
  });

  it('is false outside tolerance', () => {
    expect(isDueAround(20, TODAY)).toBe(false);
  });

  it('is false when there is no pattern', () => {
    expect(isDueAround(null, TODAY)).toBe(false);
  });

  it('wraps around the month end', () => {
    // On the 1st, something due on the 30th is one day away, not 29.
    const first = new Date('2026-08-01T00:00:00Z');
    expect(isDueAround(30, first)).toBe(true);
  });

  it('clamps a day-31 pattern into a short month', () => {
    const febEnd = new Date('2026-02-28T00:00:00Z');
    expect(isDueAround(31, febEnd)).toBe(true);
  });
});

describe('recordedThisCycle', () => {
  it('is true when already recorded this calendar month', () => {
    expect(recordedThisCycle(iso(2026, 8, 2), TODAY)).toBe(true);
  });

  it('is false for last month', () => {
    expect(recordedThisCycle(iso(2026, 7, 30), TODAY)).toBe(false);
  });

  it('handles an unparseable date without throwing', () => {
    expect(recordedThisCycle('nope', TODAY)).toBe(false);
  });
});

describe('relativeDay', () => {
  it('describes the gap in owner language', () => {
    expect(relativeDay(iso(2026, 8, 5), TODAY)).toBe('today');
    expect(relativeDay(iso(2026, 8, 4), TODAY)).toBe('yesterday');
    expect(relativeDay(iso(2026, 8, 1), TODAY)).toBe('4 days ago');
    expect(relativeDay(iso(2026, 7, 1), TODAY)).toBe('a month ago');
  });
});

describe('summaryLine', () => {
  it('reads as a sentence an owner can scan', () => {
    expect(summaryLine(facts(), TODAY)).toBe('6 times · avg ₹8,000 · last a month ago');
  });

  it('singularises a one-off', () => {
    expect(summaryLine(facts({ occurrences: 1 }), TODAY)).toContain('1 time ·');
  });
});

describe('scoreMemory — frequency first, recency second', () => {
  it('ranks a frequent expense above a recent one-off', () => {
    // Otherwise a one-off repair yesterday buries the weekly rice delivery.
    const frequent = scoreMemory({ occurrences: 12, lastDate: iso(2026, 7, 20), dueAroundNow: false }, TODAY);
    const recentOneOff = scoreMemory({ occurrences: 1, lastDate: iso(2026, 8, 4), dueAroundNow: false }, TODAY);
    expect(frequent).toBeGreaterThan(recentOneOff);
  });

  it('lets something due around now jump the queue', () => {
    const due = scoreMemory({ occurrences: 2, lastDate: iso(2026, 7, 5), dueAroundNow: true }, TODAY);
    const frequent = scoreMemory({ occurrences: 20, lastDate: iso(2026, 8, 4), dueAroundNow: false }, TODAY);
    expect(due).toBeGreaterThan(frequent);
  });

  it('caps frequency so one runaway entry cannot dominate forever', () => {
    const a = scoreMemory({ occurrences: 20, lastDate: iso(2026, 8, 5), dueAroundNow: false }, TODAY);
    const b = scoreMemory({ occurrences: 500, lastDate: iso(2026, 8, 5), dueAroundNow: false }, TODAY);
    expect(a).toBe(b);
  });
});

describe('buildMemoryEntry', () => {
  it('flags something due around now', () => {
    // Typical day is the 5th, today is the 5th, last recorded in July.
    const entry = buildMemoryEntry(facts(), TODAY);
    expect(entry.typicalDayOfMonth).toBe(5);
    expect(entry.dueAroundNow).toBe(true);
  });

  it('does not nudge when it is already recorded this month', () => {
    const entry = buildMemoryEntry(facts({ lastDate: iso(2026, 8, 5) }), TODAY);
    expect(entry.dueAroundNow).toBe(false);
  });

  it('does not nudge without a pattern', () => {
    const entry = buildMemoryEntry(facts({ daysOfMonth: [2, 11, 19, 27], occurrences: 4 }), TODAY);
    expect(entry.typicalDayOfMonth).toBeNull();
    expect(entry.dueAroundNow).toBe(false);
  });
});

describe('sortMemory', () => {
  it('puts due-now first, then frequency', () => {
    const entries = [
      buildMemoryEntry(facts({ key: 'Internet', daysOfMonth: [20, 20, 20], occurrences: 9, lastDate: iso(2026, 7, 20) }), TODAY),
      buildMemoryEntry(facts({ key: 'Rice purchase' }), TODAY),
    ];
    expect(sortMemory(entries)[0].key).toBe('Rice purchase');
  });

  it('is stable for equal scores', () => {
    const a = buildMemoryEntry(facts({ key: 'Zinc', daysOfMonth: [1, 15, 28], occurrences: 3, lastDate: iso(2026, 8, 5) }), TODAY);
    const b = buildMemoryEntry(facts({ key: 'Alpha', daysOfMonth: [1, 15, 28], occurrences: 3, lastDate: iso(2026, 8, 5) }), TODAY);
    expect(sortMemory([a, b]).map((e) => e.key)).toEqual(['Alpha', 'Zinc']);
  });

  it('does not mutate the input', () => {
    const list = [buildMemoryEntry(facts({ key: 'B' }), TODAY), buildMemoryEntry(facts({ key: 'A' }), TODAY)];
    sortMemory(list);
    expect(list[0].key).toBe('B');
  });
});

describe('reusePayload — never invents a value', () => {
  it('reuses everything the owner previously supplied', () => {
    expect(reusePayload(buildMemoryEntry(facts(), TODAY))).toEqual({
      title: 'Rice purchase',
      amount: 8200,
      category: 'Food & Groceries',
      vendorName: 'Sri Rice Traders',
      paymentMethod: 'UPI',
      notes: '50kg bag',
    });
  });

  it('prefills the LAST amount, not the average', () => {
    // The average is a number that never actually occurred.
    const entry = buildMemoryEntry(facts({ lastAmount: 8200, averageAmount: 8000 }), TODAY);
    expect(reusePayload(entry).amount).toBe(8200);
  });

  it('leaves fields null where history is silent, rather than guessing', () => {
    const entry = buildMemoryEntry(
      facts({ category: null, paymentMethod: null, notes: null, vendorName: null }),
      TODAY,
    );
    const payload = reusePayload(entry);
    expect(payload.category).toBeNull();
    expect(payload.paymentMethod).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.vendorName).toBeNull();
  });

  it('uses the vendor name as the title for a vendor-keyed entry', () => {
    const entry = buildMemoryEntry(facts({ kind: 'VENDOR', key: 'Sri Rice Traders', vendorName: null }), TODAY);
    const payload = reusePayload(entry);
    expect(payload.title).toBe('Sri Rice Traders');
    expect(payload.vendorName).toBe('Sri Rice Traders');
  });
});
