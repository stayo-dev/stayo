import { describe, it, expect } from 'vitest';
import {
  financialYearOf, financialYearLabel, financialYearPeriod,
  monthPeriod, resolvePreset, customPeriod, periodPresets,
  dayPeriod, rollingWeekPeriod, allTimePeriod, isAllTime, periodSlug,
} from '@/src/services/exports/financial-year';

/**
 * The Indian FY runs April–March. An export that runs Jan–Dec is not slightly
 * wrong for an accountant, it is useless — and the owner finds out in July.
 */
describe('financialYearOf', () => {
  it('starts the year in April, not January', () => {
    expect(financialYearOf(new Date('2026-04-01T06:00:00Z'))).toBe(2026);
    expect(financialYearOf(new Date('2026-03-31T06:00:00Z'))).toBe(2025);
  });

  it('puts January in the FY that began the previous calendar year', () => {
    // The case a naive `year - 1` gets wrong, and the reason "last FY" needs
    // its own test: in January the CURRENT fy already started last year.
    expect(financialYearOf(new Date('2027-01-15T06:00:00Z'))).toBe(2026);
    expect(resolvePreset('last_fy', new Date('2027-01-15T06:00:00Z')).label).toBe('Apr 2025 – Mar 2026');
  });

  it('uses the IST day, so a late-evening export is not a day early', () => {
    // 2026-03-31T20:00Z is already 1 Apr in IST — a new financial year.
    expect(financialYearOf(new Date('2026-03-31T20:00:00Z'))).toBe(2026);
  });

  it('labels the year the way an accountant writes it', () => {
    expect(financialYearLabel(2026)).toBe('2026-27');
    expect(financialYearLabel(2099)).toBe('2099-00');
  });
});

describe('financialYearPeriod', () => {
  it('covers 1 April to 31 March inclusive', () => {
    expect(financialYearPeriod(2026)).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
      label: 'Apr 2026 – Mar 2027',
    });
  });
});

describe('monthPeriod', () => {
  it('ends on the real last day, not a fixed 30', () => {
    expect(monthPeriod(2026, 1).to).toBe('2026-02-28');
    expect(monthPeriod(2028, 1).to).toBe('2028-02-29'); // leap
    expect(monthPeriod(2026, 0).to).toBe('2026-01-31');
  });

  it('rolls the year back rather than producing month -1', () => {
    // "Last month" in January is the one month in twelve where this breaks.
    expect(monthPeriod(2026, -1)).toEqual({
      from: '2025-12-01', to: '2025-12-31', label: 'December 2025',
    });
  });
});

describe('resolvePreset', () => {
  it('resolves last month across a year boundary', () => {
    expect(resolvePreset('last_month', new Date('2026-01-10T06:00:00Z')).label).toBe('December 2025');
  });

  it('offers a current-FY preset the owner can recognise by name', () => {
    const presets = periodPresets(new Date('2026-08-23T06:00:00Z'));
    expect(presets.find((p) => p.id === 'this_fy')?.sub).toBe('2026-27 · Apr 2026 – Mar 2027');
  });
});

describe('customPeriod', () => {
  it('refuses a reversed range instead of quietly swapping it', () => {
    // Silently repairing produces a document that looks right and covers the
    // wrong period — worse than an error the owner can see.
    expect(() => customPeriod('2026-08-31', '2026-08-01')).toThrow(/start date is after/);
  });

  it('refuses a malformed date', () => {
    expect(() => customPeriod('31-08-2026', '2026-08-31')).toThrow(/YYYY-MM-DD/);
  });

  it('labels a single day and a span differently', () => {
    expect(customPeriod('2026-08-01', '2026-08-01').label).toBe('1 Aug 2026');
    // Day-precise on both ends. A month-only label printed "Apr 2026 – Sep 2026"
    // for 15 Apr – 12 Sep too, which describes a period the owner did not pick.
    expect(customPeriod('2026-04-01', '2026-09-30').label).toBe('1 Apr 2026 – 30 Sep 2026');
    expect(customPeriod('2026-04-15', '2026-09-12').label).toBe('15 Apr 2026 – 12 Sep 2026');
  });

  it('allows a one-sided range, because the Expenses custom chip does', () => {
    const upTo = customPeriod(null, '2026-09-12');
    expect(upTo.from).toBeNull();
    expect(upTo.label).toBe('Up to 12 Sep 2026');

    // An open upper bound means "up to now", never "forever".
    const since = customPeriod('2026-03-01', null, new Date('2026-09-21T06:00:00Z'));
    expect(since.to).toBe('2026-09-21');
    expect(since.label).toBe('1 Mar 2026 – 21 Sep 2026');
  });

  it('refuses a range with neither end — that is not a range', () => {
    expect(() => customPeriod(null, null)).toThrow(/Give a preset/);
  });
});

describe('dayPeriod', () => {
  it('is one IST day at both ends', () => {
    const p = dayPeriod(new Date('2026-09-21T06:00:00Z'));
    expect(p).toEqual({ from: '2026-09-21', to: '2026-09-21', label: '21 Sep 2026' });
  });

  it('uses the IST day, so a late-evening export is not a day early', () => {
    // 20:00Z is already the next day in IST — the owner's "today", not UTC's.
    expect(dayPeriod(new Date('2026-03-31T20:00:00Z')).from).toBe('2026-04-01');
  });
});

describe('rollingWeekPeriod', () => {
  /**
   * Seven days ending today, NOT the calendar week. `expense-service`'s own
   * `week` branch starts on Sunday and ends seven days later, so on a Tuesday
   * it covers four days that have not happened yet. The export and the list
   * above it must not disagree about what "this week" contains.
   */
  it('spans exactly seven days, inclusive, ending today', () => {
    const p = rollingWeekPeriod(new Date('2026-09-21T06:00:00Z'));
    expect(p.from).toBe('2026-09-15');
    expect(p.to).toBe('2026-09-21');
  });

  it('never runs into the future', () => {
    const now = new Date('2026-09-21T06:00:00Z');
    expect(rollingWeekPeriod(now).to).toBe(dayPeriod(now).to);
  });

  it('crosses a month boundary', () => {
    expect(rollingWeekPeriod(new Date('2026-10-03T06:00:00Z')).from).toBe('2026-09-27');
  });

  it('crosses a year boundary', () => {
    expect(rollingWeekPeriod(new Date('2027-01-03T06:00:00Z')).from).toBe('2026-12-28');
  });
});

describe('allTimePeriod', () => {
  /**
   * `from: null` rather than an early sentinel. A made-up 1970 start would
   * print in the label, in the filename and on the report sheet as a range the
   * owner never asked for.
   */
  it('has no lower bound at all', () => {
    const p = allTimePeriod(new Date('2026-09-21T06:00:00Z'));
    expect(p.from).toBeNull();
    expect(isAllTime(p)).toBe(true);
  });

  it('stops at today, because a report cannot contain the future', () => {
    expect(allTimePeriod(new Date('2026-09-21T06:00:00Z')).to).toBe('2026-09-21');
  });

  it('says so in the label, with the date it actually stops at', () => {
    expect(allTimePeriod(new Date('2026-09-21T06:00:00Z')).label).toBe('All time (up to 21 Sep 2026)');
  });

  it('is the only preset that is all-time', () => {
    const now = new Date('2026-09-21T06:00:00Z');
    const bounded = ['today', 'this_week', 'this_month', 'last_month', 'this_fy', 'last_fy'] as const;
    for (const id of bounded) expect(isAllTime(resolvePreset(id, now))).toBe(false);
    expect(isAllTime(resolvePreset('all_time', now))).toBe(true);
  });
});

describe('periodSlug', () => {
  it('names a bounded period by both ends', () => {
    expect(periodSlug(monthPeriod(2026, 8))).toBe('2026-09-01-to-2026-09-30');
  });

  it('never invents a start date for an unbounded one', () => {
    expect(periodSlug(allTimePeriod(new Date('2026-09-21T06:00:00Z')))).toBe('all-time-to-2026-09-21');
  });
});

describe('the preset picker', () => {
  it('offers every preset the screens can ask for', () => {
    expect(periodPresets(new Date('2026-09-21T06:00:00Z')).map((p) => p.id)).toEqual([
      'today', 'this_week', 'this_month', 'last_month', 'this_fy', 'last_fy', 'all_time',
    ]);
  });
});
