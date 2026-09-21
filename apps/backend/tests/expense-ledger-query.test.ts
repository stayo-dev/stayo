import { describe, it, expect } from 'vitest';
import {
  buildExpenseLedgerWhere,
  resolveExpenseSort,
  normalizeExpenseStatus,
  getRange,
} from '@/lib/services/expenses/expense-ledger-query';

/**
 * The rules that decide which expenses an export contains.
 *
 * These lived inside `expense-service.ts` next to `prisma`, so none of them
 * could be tested without a database — and this environment has none. They are
 * asserted here against the returned WHERE object, which is the actual contract
 * between the list screen and the export (ADR-009: one builder, never two).
 */

const OWNER = 'owner-1';

describe('the date window', () => {
  it('has no lower bound when the caller explicitly says "no lower bound"', () => {
    // `startDate: null` is the honest representation of the "All time" chip.
    // It is NOT the same as omitting the field, which falls through to `range`.
    const { where } = buildExpenseLedgerWhere(OWNER, { startDate: null, endDate: '2026-09-21' });
    expect(where.date.gte).toBeUndefined();
  });

  it('still stops at the end date, even for all time', () => {
    // The label says "All time (up to 21 Sep 2026)". A future-dated row landing
    // in that file would make the label a lie.
    const { where } = buildExpenseLedgerWhere(OWNER, { startDate: null, endDate: '2026-09-21' });
    expect(where.date.lt).toEqual(new Date(2026, 8, 22));
  });

  it('keeps an inclusive end date inclusive, by ending exclusively the next day', () => {
    const { where } = buildExpenseLedgerWhere(OWNER, { startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(where.date.gte).toEqual(new Date('2026-09-01'));
    expect(where.date.lt).toEqual(new Date(2026, 9, 1));
  });

  it('treats a cleared date input as absent, not as an explicit bound', () => {
    // The screens send '' for a cleared date; that must fall through to the
    // range preset rather than silently meaning "the 1st of this month".
    const cleared = getRange({ startDate: '', endDate: '' });
    const none = getRange({});
    expect(cleared).toEqual(none);
  });

  it('gives the all_time range preset no lower bound either', () => {
    // The list asks for a period the same way the export does, so the two
    // cannot mean different things by "All time".
    expect(getRange({ range: 'all_time' }).start).toBeNull();
  });

  it('never lets all_time reach into the future', () => {
    const end = getRange({ range: 'all_time' }).end;
    expect(end.getTime()).toBeGreaterThan(Date.now());
    expect(end.getTime() - Date.now()).toBeLessThan(48 * 60 * 60 * 1000);
  });

  it('reads "this week" as the rolling seven days ending today', () => {
    // It was a Sunday-start window ending seven days later, so on a Tuesday it
    // covered four days that had not happened yet — and disagreed with the file
    // the owner exported from the same screen.
    const { start, end } = getRange({ range: 'week' });
    const days = Math.round((end.getTime() - start!.getTime()) / 86_400_000);
    expect(days).toBe(7); // 7 inclusive days = a 7-day half-open interval
    expect(end.getTime()).toBeGreaterThan(Date.now());
  });

  it('distinguishes an omitted start from a null one', () => {
    expect(getRange({}).start).not.toBeNull();
    expect(getRange({ startDate: null, endDate: '2026-09-21' }).start).toBeNull();
  });
});

describe('scope', () => {
  it('narrows to business (HQ) expenses via expense_scope, never a hostel id', () => {
    // The Money screen's `business` option used to collapse to null on its way
    // to the API, which reads as EVERY hostel — the opposite of what was picked.
    const { where } = buildExpenseLedgerWhere(OWNER, { scope: 'business' });
    expect(where.expense_scope).toBe('BUSINESS');
    expect(where.hostel_id).toBeUndefined();
  });

  it('scopes to one hostel when given a real id', () => {
    const { where } = buildExpenseLedgerWhere(OWNER, { hostelId: 'hostel-7' });
    expect(where.hostel_id).toBe('hostel-7');
    expect(where.expense_scope).toBeUndefined();
  });

  it('always scopes to the owner', () => {
    expect(buildExpenseLedgerWhere(OWNER, {}).where.owner_id).toBe(OWNER);
  });
});

describe('vendor and payment method', () => {
  /**
   * These two filtered nothing before. The old export accepted them and printed
   * them on a cover page as a "filter snapshot" while the rows ignored them —
   * a file that states it is filtered and is not.
   */
  it('filters on vendor', () => {
    expect(buildExpenseLedgerWhere(OWNER, { vendor: 'Sri Balaji Traders' }).where.vendor_name)
      .toBe('Sri Balaji Traders');
  });

  it('filters on payment method', () => {
    expect(buildExpenseLedgerWhere(OWNER, { paymentMethod: 'UPI' }).where.payment_method).toBe('UPI');
  });

  it('omits both when they are not set, rather than matching empty string', () => {
    const { where } = buildExpenseLedgerWhere(OWNER, {});
    expect('vendor_name' in where).toBe(false);
    expect('payment_method' in where).toBe(false);
  });
});

describe('normalizeExpenseStatus', () => {
  /**
   * The screen says 'Paid'; the column holds 'paid'. An exact match on the
   * screen's casing returned zero rows with no error — an empty export that
   * reads as "you have no expenses" rather than as a bug.
   */
  it('lowercases and underscores what the screen shows', () => {
    expect(normalizeExpenseStatus('Paid')).toBe('paid');
    expect(normalizeExpenseStatus('Pending')).toBe('pending');
    expect(normalizeExpenseStatus('Partially Paid')).toBe('partially_paid');
  });

  it('treats the screen\'s "no filter" options as no filter', () => {
    expect(normalizeExpenseStatus('All Status')).toBeUndefined();
    expect(normalizeExpenseStatus('all')).toBeUndefined();
    expect(normalizeExpenseStatus('')).toBeUndefined();
    expect(normalizeExpenseStatus(undefined)).toBeUndefined();
    expect(normalizeExpenseStatus(null)).toBeUndefined();
  });

  it('leaves an already-normalised status alone', () => {
    expect(normalizeExpenseStatus('partially_paid')).toBe('partially_paid');
  });
});

describe('amount range', () => {
  it('applies each bound independently', () => {
    expect(buildExpenseLedgerWhere(OWNER, { amountMin: 5000 }).where.amount).toEqual({ gte: 5000 });
    expect(buildExpenseLedgerWhere(OWNER, { amountMax: 200 }).where.amount).toEqual({ lte: 200 });
    expect(buildExpenseLedgerWhere(OWNER, { amountMin: 100, amountMax: 900 }).where.amount)
      .toEqual({ gte: 100, lte: 900 });
  });

  it('omits the amount clause entirely when neither bound is set', () => {
    expect('amount' in buildExpenseLedgerWhere(OWNER, {}).where).toBe(false);
  });
});

describe('search', () => {
  it('requires every term to match, across any of the searched fields', () => {
    const { where } = buildExpenseLedgerWhere(OWNER, { search: 'diesel pump' });
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR.map((c: any) => Object.keys(c)[0]))
      .toEqual(['title', 'notes', 'vendor_name', 'payment_method', 'category']);
  });

  it('also matches a numeric term against the amount', () => {
    const { where } = buildExpenseLedgerWhere(OWNER, { search: '4500' });
    expect(where.AND[0].OR).toContainEqual({ amount: { equals: 4500 } });
  });
});

describe('recurring', () => {
  it('distinguishes recurring, one-time, and no opinion', () => {
    expect(buildExpenseLedgerWhere(OWNER, { recurring: true }).where.is_recurring).toBe(true);
    expect(buildExpenseLedgerWhere(OWNER, { recurring: false }).where.is_recurring).toBe(false);
    expect('is_recurring' in buildExpenseLedgerWhere(OWNER, {}).where).toBe(false);
  });
});

describe('resolveExpenseSort', () => {
  it('sorts by amount in both directions', () => {
    expect(resolveExpenseSort('highest')).toEqual({ amount: 'desc' });
    expect(resolveExpenseSort('lowest')).toEqual({ amount: 'asc' });
  });

  it('sorts by date in both directions, newest by default', () => {
    expect(resolveExpenseSort('oldest')).toEqual({ date: 'asc' });
    expect(resolveExpenseSort('recent')).toEqual({ date: 'desc' });
    expect(resolveExpenseSort(undefined)).toEqual({ date: 'desc' });
    expect(resolveExpenseSort('nonsense')).toEqual({ date: 'desc' });
  });
});
