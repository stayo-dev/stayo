import type { ExpenseFilterState } from '../types';

/**
 * The Money screen's state, as an export request.
 *
 * This is where "the file contains exactly what is on screen" is actually
 * decided, so it is a pure module with no React in it: the frontend suite is
 * node-only with no DOM, and a mapping that can only be checked by clicking
 * through the app is a mapping that silently rots.
 *
 * Nothing here resolves a date to a range — presets travel by NAME and the
 * server resolves them (ADR-095), so "this financial year" means April–March
 * because the server says so, not because a browser agreed.
 */

export type MoneyExportId = 'expenses' | 'collections' | 'finance';
export type DateRangeChip = 'today' | 'week' | 'month' | 'all' | 'custom';
export type PeriodPresetId =
  | 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_fy' | 'last_fy' | 'all_time' | 'custom';

/**
 * A finished query, or the reason there isn't one.
 *
 * Deliberately NOT a discriminated union on an `ok` flag: this project compiles
 * with `strict: false`, where narrowing on a boolean literal discriminant is
 * unreliable. Two nullable fields narrow correctly everywhere.
 */
export type ExportQuery = {
  query: Record<string, string> | null;
  /** Why it cannot be built, in words the owner can act on. */
  error: string | null;
};

const ok = (query: Record<string, string>): ExportQuery => ({ query, error: null });
const fail = (error: string): ExportQuery => ({ query: null, error });

/** Exactly the MoneyPage state that decides what an expenses export contains. */
export type ExpenseScreenState = {
  /** 'all' | 'business' | a real hostel id. */
  hostelFilter: string;
  dateRange: DateRangeChip;
  search: string;
  filters: ExpenseFilterState;
};

/**
 * `'all'` and `'business'` are view sentinels, not hostel ids.
 *
 * `'business'` previously collapsed to `null` on its way to the API, which the
 * API reads as *every* hostel — the exact opposite of what the owner picked.
 * It now travels as its own `scope` param and lands on `expense_scope`, so it
 * can never reach a WHERE clause on `hostel_id` (ADR-003).
 */
export function hostelScopeParams(hostelFilter: string): { hostelId?: string; scope?: 'business' } {
  if (hostelFilter === 'business') return { scope: 'business' };
  if (!hostelFilter || hostelFilter === 'all') return {};
  return { hostelId: hostelFilter };
}

const CHIP_TO_PRESET: Record<Exclude<DateRangeChip, 'custom'>, PeriodPresetId> = {
  today: 'today',
  week: 'this_week',
  month: 'this_month',
  all: 'all_time',
};

/** A `datetime-local` value ("2026-09-01T14:30") as the date the server wants. */
function asDate(value: string): string {
  return (value ?? '').slice(0, 10);
}

/**
 * The chip, or the filter sheet's custom dates, as a server period.
 *
 * A reversed range is refused here rather than sent, so the owner is told by
 * the control he just used instead of by a failed download.
 */
export function periodParams(chip: DateRangeChip, filters: ExpenseFilterState): ExportQuery {
  if (chip !== 'custom') return ok({ preset: CHIP_TO_PRESET[chip] });

  const from = asDate(filters.startDate);
  const to = asDate(filters.endDate);
  if (!from && !to) return fail('Pick a start or an end date');
  if (from && to && from > to) return fail('The start date is after the end date');

  const query: Record<string, string> = {};
  if (from) query.from = from;
  if (to) query.to = to;
  return ok(query);
}

/** 'Paid' -> 'paid'. The casing mismatch that would have returned an empty file. */
export function statusParam(status: ExpenseFilterState['status']): string | undefined {
  return status === 'All Status' ? undefined : status.toLowerCase().replace(/\s+/g, '_');
}

/** 'Amount: Low to high' -> 'lowest'. */
export function sortParam(sort: ExpenseFilterState['sort']): 'recent' | 'oldest' | 'highest' | 'lowest' {
  if (sort === 'Oldest') return 'oldest';
  if (sort === 'Amount: High to low') return 'highest';
  if (sort === 'Amount: Low to high') return 'lowest';
  return 'recent';
}

/**
 * A finite number, or nothing.
 *
 * `Number('') || Infinity` is the pattern the list uses for an unset maximum;
 * serialising that would send `amountMax=Infinity`, which the server refuses.
 */
function amountParam(raw: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? String(value) : undefined;
}

/** Only the entries that carry a real value — an empty param is not a filter. */
function compact(entries: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/** The Expenses tab: the hostel, the date chip, the search box and every filter. */
export function expensesExportQuery(s: ExpenseScreenState): ExportQuery {
  const period = periodParams(s.dateRange, s.filters);
  if (!period.query) return period;

  return ok(
    compact({
      document: 'expenses',
      ...period.query,
      ...hostelScopeParams(s.hostelFilter),
      search: s.search.trim() || undefined,
      status: statusParam(s.filters.status),
      vendor: s.filters.vendor ?? undefined,
      paymentMethod: s.filters.paymentMethod ?? undefined,
      amountMin: amountParam(s.filters.amountMin),
      amountMax: amountParam(s.filters.amountMax),
      recurring: s.filters.recurring === 'all' ? undefined : String(s.filters.recurring === 'recurring'),
      sort: sortParam(s.filters.sort),
    }),
  );
}

type PeriodChoice = { preset: PeriodPresetId; from?: string; to?: string };

/**
 * Collections and Finance ask for a period, because neither screen implies one:
 * the Collections tab is a live list of who owes now, and Overview is a set of
 * this-month cards.
 *
 * Neither ever sends `scope=business`. A rent payment has no business-HQ
 * scope, and these two screens show every hostel regardless of that chip.
 */
function periodOnlyQuery(document: 'collections' | 'finance', hostelFilter: string, period: PeriodChoice): ExportQuery {
  const query: Record<string, string> = { document };

  if (period.preset === 'custom') {
    const from = asDate(period.from ?? '');
    const to = asDate(period.to ?? '');
    if (!from && !to) return fail('Pick a start or an end date');
    if (from && to && from > to) return fail('The start date is after the end date');
    if (from) query.from = from;
    if (to) query.to = to;
  } else {
    query.preset = period.preset;
  }

  const scope = hostelScopeParams(hostelFilter);
  if (scope.hostelId) query.hostelId = scope.hostelId;

  return ok(query);
}

export function collectionsExportQuery(hostelFilter: string, period: PeriodChoice): ExportQuery {
  return periodOnlyQuery('collections', hostelFilter, period);
}

export function financeExportQuery(hostelFilter: string, period: PeriodChoice): ExportQuery {
  return periodOnlyQuery('finance', hostelFilter, period);
}

export function buildExportQuery(
  target: MoneyExportId,
  screen: ExpenseScreenState,
  period: PeriodChoice,
): ExportQuery {
  if (target === 'expenses') return expensesExportQuery(screen);
  if (target === 'collections') return collectionsExportQuery(screen.hostelFilter, period);
  return financeExportQuery(screen.hostelFilter, period);
}
