import { describe, it, expect } from 'vitest';
import {
  hostelScopeParams, periodParams, statusParam, sortParam,
  expensesExportQuery, collectionsExportQuery, financeExportQuery, buildExportQuery,
  expenseListParams,
  type ExpenseScreenState,
} from './exportRequest';
import { EMPTY_EXPENSE_FILTERS, type ExpenseFilterState } from '../types';

/**
 * "The file contains exactly what is on screen" is decided here, so this is
 * where it is checked. Components cannot be rendered in this suite, which is
 * precisely why none of this logic lives in one.
 */

const screen = (over: Partial<ExpenseScreenState> = {}): ExpenseScreenState => ({
  hostelFilter: 'all',
  dateRange: 'month',
  search: '',
  filters: EMPTY_EXPENSE_FILTERS,
  ...over,
});

const filters = (over: Partial<ExpenseFilterState> = {}): ExpenseFilterState => ({
  ...EMPTY_EXPENSE_FILTERS,
  ...over,
});

const unwrap = (r: ReturnType<typeof expensesExportQuery>) => {
  if (!r.query) throw new Error(`expected a query, got error: ${r.error}`);
  return r.query;
};

describe('hostel scope', () => {
  it('sends nothing at all for the portfolio view', () => {
    expect(hostelScopeParams('all')).toEqual({});
    expect(hostelScopeParams('')).toEqual({});
  });

  it('sends a real hostel id as a hostel id', () => {
    expect(hostelScopeParams('hostel-7')).toEqual({ hostelId: 'hostel-7' });
  });

  it('sends business as a scope, never as a hostel id', () => {
    expect(hostelScopeParams('business')).toEqual({ scope: 'business' });
  });

  it('never lets a view sentinel reach hostelId', () => {
    // `business` used to collapse to null, which the API reads as EVERY hostel
    // — the opposite of what the owner picked.
    for (const sentinel of ['all', 'business', '']) {
      expect(hostelScopeParams(sentinel).hostelId).toBeUndefined();
    }
  });
});

describe('period', () => {
  it('maps every chip to the preset the server knows', () => {
    expect(unwrap(periodParams('today', EMPTY_EXPENSE_FILTERS))).toEqual({ preset: 'today' });
    expect(unwrap(periodParams('week', EMPTY_EXPENSE_FILTERS))).toEqual({ preset: 'this_week' });
    expect(unwrap(periodParams('month', EMPTY_EXPENSE_FILTERS))).toEqual({ preset: 'this_month' });
    expect(unwrap(periodParams('all', EMPTY_EXPENSE_FILTERS))).toEqual({ preset: 'all_time' });
  });

  it('sends a preset by name, never a resolved date', () => {
    // Resolving client-side is how "this financial year" quietly becomes
    // January–December.
    const q = unwrap(periodParams('month', EMPTY_EXPENSE_FILTERS));
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
  });

  it('reduces a datetime-local custom range to plain dates', () => {
    const q = unwrap(periodParams('custom', filters({ startDate: '2026-09-01T14:30', endDate: '2026-09-30T23:59' })));
    expect(q).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('allows a one-sided custom range', () => {
    expect(unwrap(periodParams('custom', filters({ endDate: '2026-09-12' })))).toEqual({ to: '2026-09-12' });
    expect(unwrap(periodParams('custom', filters({ startDate: '2026-03-01' })))).toEqual({ from: '2026-03-01' });
  });

  it('refuses a reversed range at the control the owner just used', () => {
    const r = periodParams('custom', filters({ startDate: '2026-09-30', endDate: '2026-09-01' }));
    expect(r).toEqual({ query: null, error: 'The start date is after the end date' });
  });

  it('refuses a custom range with no dates at all', () => {
    expect(periodParams('custom', EMPTY_EXPENSE_FILTERS).error).toBe('Pick a start or an end date');
  });
});

describe('status and sort', () => {
  it("matches the column's casing, not the screen's", () => {
    expect(statusParam('Paid')).toBe('paid');
    expect(statusParam('Pending')).toBe('pending');
    expect(statusParam('Partially Paid')).toBe('partially_paid');
  });

  it('sends no status at all when none is chosen', () => {
    expect(statusParam('All Status')).toBeUndefined();
  });

  it('maps every sort the sheet offers', () => {
    expect(sortParam('Recent')).toBe('recent');
    expect(sortParam('Oldest')).toBe('oldest');
    expect(sortParam('Amount: High to low')).toBe('highest');
    expect(sortParam('Amount: Low to high')).toBe('lowest');
  });
});

describe('the expenses export carries the whole screen', () => {
  it('sends every filter the owner has set', () => {
    const q = unwrap(expensesExportQuery(screen({
      hostelFilter: 'hostel-7',
      dateRange: 'week',
      search: '  diesel  ',
      filters: filters({
        status: 'Partially Paid',
        sort: 'Amount: Low to high',
        vendor: 'Sri Balaji',
        paymentMethod: 'UPI',
        recurring: 'recurring',
        amountMin: '100',
        amountMax: '900',
      }),
    })));

    expect(q).toEqual({
      document: 'expenses',
      preset: 'this_week',
      hostelId: 'hostel-7',
      search: 'diesel',
      status: 'partially_paid',
      vendor: 'Sri Balaji',
      paymentMethod: 'UPI',
      amountMin: '100',
      amountMax: '900',
      recurring: 'true',
      sort: 'lowest',
    });
  });

  it('sends only what is actually set when nothing is filtered', () => {
    const q = unwrap(expensesExportQuery(screen()));
    expect(q).toEqual({ document: 'expenses', preset: 'this_month', sort: 'recent' });
  });

  it('never emits an empty-string parameter', () => {
    // An empty `vendor=` is falsy on the server today and harmless; relying on
    // that is how a filter starts silently mattering.
    const q = unwrap(expensesExportQuery(screen({ search: '   ' })));
    expect(Object.values(q).every((v) => v !== '')).toBe(true);
    expect('search' in q).toBe(false);
  });

  it('never serialises Infinity as an amount', () => {
    // `Number('') || Infinity` is the pattern the list itself uses.
    const q = unwrap(expensesExportQuery(screen({
      filters: filters({ amountMin: '', amountMax: 'Infinity' }),
    })));
    expect('amountMin' in q).toBe(false);
    expect('amountMax' in q).toBe(false);
  });

  it('reads recurring as three states, not two', () => {
    const rec = (v: ExpenseFilterState['recurring']) =>
      unwrap(expensesExportQuery(screen({ filters: filters({ recurring: v }) }))).recurring;
    expect(rec('recurring')).toBe('true');
    expect(rec('one-time')).toBe('false');
    // "All" must not collapse to false, which would exclude every recurring row.
    expect(rec('all')).toBeUndefined();
  });

  it('sends the business scope when the owner is looking at HQ', () => {
    const q = unwrap(expensesExportQuery(screen({ hostelFilter: 'business' })));
    expect(q.scope).toBe('business');
    expect('hostelId' in q).toBe(false);
  });

  it('refuses rather than exporting the wrong period', () => {
    const r = expensesExportQuery(screen({
      dateRange: 'custom',
      filters: filters({ startDate: '2026-09-30', endDate: '2026-09-01' }),
    }));
    expect(r.error).toBe('The start date is after the end date');
  });
});

describe('collections and finance', () => {
  const period = { preset: 'this_fy' as const };

  it('ask for a period, because neither screen implies one', () => {
    expect(unwrap(collectionsExportQuery('all', period))).toEqual({ document: 'collections', preset: 'this_fy' });
    expect(unwrap(financeExportQuery('all', period))).toEqual({ document: 'finance', preset: 'this_fy' });
  });

  it('carry a real hostel filter', () => {
    expect(unwrap(collectionsExportQuery('hostel-7', period)).hostelId).toBe('hostel-7');
  });

  it('never send the business scope, which rent has no concept of', () => {
    // The API rejects scope on these two; sending it would be a 400 the owner
    // could not explain, triggered just by which chip he last tapped.
    for (const build of [collectionsExportQuery, financeExportQuery]) {
      const q = unwrap(build('business', period));
      expect('scope' in q).toBe(false);
      expect('hostelId' in q).toBe(false);
    }
  });

  it('never carry the Expenses tab filters', () => {
    // A stale search box must not quietly narrow a collections file.
    const q = unwrap(buildExportQuery('collections', screen({
      search: 'diesel',
      filters: filters({ vendor: 'Sri Balaji', status: 'Paid' }),
    }), period));
    expect(q).toEqual({ document: 'collections', preset: 'this_fy' });
  });

  it('support a custom range of their own', () => {
    expect(unwrap(financeExportQuery('all', { preset: 'custom', from: '2026-04-01', to: '2026-09-30' })))
      .toEqual({ document: 'finance', from: '2026-04-01', to: '2026-09-30' });
  });

  it('refuse a reversed custom range', () => {
    expect(collectionsExportQuery('all', { preset: 'custom', from: '2026-09-30', to: '2026-04-01' }).error).toBeTruthy();
  });
});

describe('buildExportQuery', () => {
  it('routes each target to its own builder', () => {
    const s = screen();
    const p = { preset: 'this_month' as const };
    expect(unwrap(buildExportQuery('expenses', s, p)).document).toBe('expenses');
    expect(unwrap(buildExportQuery('collections', s, p)).document).toBe('collections');
    expect(unwrap(buildExportQuery('finance', s, p)).document).toBe('finance');
  });
});

describe('the list asks for the same rows the export does', () => {
  /**
   * The list and the export resolving through different rules is how a file
   * ends up describing different rows than the screen it came from. They share
   * every mapping helper and differ only where the endpoints genuinely do.
   */
  it('carries the same filters, under the list endpoint\'s names', () => {
    const state = screen({
      hostelFilter: 'hostel-7',
      dateRange: 'week',
      search: 'diesel',
      filters: filters({ status: 'Paid', vendor: 'Sri Balaji', recurring: 'one-time', sort: 'Oldest' }),
    });

    expect(expenseListParams(state, 500)).toEqual({
      range: 'week',
      hostelId: 'hostel-7',
      search: 'diesel',
      status: 'paid',
      vendor: 'Sri Balaji',
      recurring: 'false',
      sort: 'oldest',
      limit: '500',
    });
  });

  it('asks the list for all time when the chip says all time', () => {
    // Previously "All time" narrowed 100 already-fetched rows of the current
    // month, so it showed one month.
    expect(expenseListParams(screen({ dateRange: 'all' }), 500).range).toBe('all_time');
  });

  it('agrees with the export about the hostel scope', () => {
    const state = screen({ hostelFilter: 'business' });
    const list = expenseListParams(state, 500);
    const exported = expensesExportQuery(state).query!;
    expect(list.scope).toBe('business');
    expect(exported.scope).toBe('business');
    expect('hostelId' in list).toBe(false);
  });

  it('agrees with the export about every shared filter', () => {
    const state = screen({
      hostelFilter: 'hostel-7',
      search: 'diesel',
      filters: filters({ status: 'Partially Paid', vendor: 'V', paymentMethod: 'UPI', amountMin: '100', sort: 'Amount: Low to high' }),
    });
    const list = expenseListParams(state, 500);
    const exported = expensesExportQuery(state).query!;
    for (const k of ['hostelId', 'search', 'status', 'vendor', 'paymentMethod', 'amountMin', 'sort']) {
      expect([k, list[k]]).toEqual([k, exported[k]]);
    }
  });

  it('declines an unusable custom range rather than asking for the wrong rows', () => {
    expect(expenseListParams(screen({
      dateRange: 'custom',
      filters: filters({ startDate: '2026-09-30', endDate: '2026-09-01' }),
    }), 500)).toBeNull();
  });
});
