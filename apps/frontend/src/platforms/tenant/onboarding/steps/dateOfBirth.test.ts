import { describe, expect, it } from 'vitest';
import {
  ageOn,
  clampToMonth,
  daysInMonth,
  defaultSelection,
  formatDisplayDate,
  parseISODate,
  selectableYears,
  toISODate,
  validateDateOfBirth,
  MIN_AGE,
  MAX_AGE,
} from './dateOfBirth';

const TODAY = new Date('2026-08-25T00:00:00Z');

describe('parsing and formatting', () => {
  it('round-trips an ISO date', () => {
    expect(toISODate({ day: 4, month: 3, year: 2004 })).toBe('2004-03-04');
    expect(parseISODate('2004-03-04')).toEqual({ day: 4, month: 3, year: 2004 });
  });

  // Going through `new Date('2004-03-04')` and reading local getDate() shifts
  // the day west of UTC — the classic "birthday one day early" bug.
  it('does not shift the day across a timezone boundary', () => {
    expect(parseISODate('2004-01-01')).toEqual({ day: 1, month: 1, year: 2004 });
    expect(parseISODate('2004-12-31')).toEqual({ day: 31, month: 12, year: 2004 });
  });

  it('rejects malformed and impossible dates', () => {
    expect(parseISODate('')).toBeNull();
    expect(parseISODate('04-03-2004')).toBeNull();
    expect(parseISODate('2004-13-01')).toBeNull();
    expect(parseISODate('2005-02-29')).toBeNull();
    expect(parseISODate(null)).toBeNull();
  });

  it('formats day-first and unambiguously', () => {
    expect(formatDisplayDate({ day: 14, month: 3, year: 2004 })).toBe('14 Mar 2004');
    expect(formatDisplayDate(null)).toBe('');
  });
});

describe('month lengths', () => {
  it('knows the short months', () => {
    expect(daysInMonth(4, 2026)).toBe(30);
    expect(daysInMonth(1, 2026)).toBe(31);
  });

  it('handles February and leap years, including the century rules', () => {
    expect(daysInMonth(2, 2005)).toBe(28);
    expect(daysInMonth(2, 2004)).toBe(29);
    expect(daysInMonth(2, 1900)).toBe(28);
    expect(daysInMonth(2, 2000)).toBe(29);
  });
});

describe('keeping a selection valid mid-edit', () => {
  // Picking 31 January then switching to February must not produce 31 Feb.
  it('clamps the day down when the new month is shorter', () => {
    expect(clampToMonth({ day: 31, month: 2, year: 2005 })).toEqual({ day: 28, month: 2, year: 2005 });
    expect(clampToMonth({ day: 31, month: 2, year: 2004 })).toEqual({ day: 29, month: 2, year: 2004 });
    expect(clampToMonth({ day: 31, month: 4, year: 2004 })).toEqual({ day: 30, month: 4, year: 2004 });
  });

  it('leaves a day that already fits alone', () => {
    expect(clampToMonth({ day: 12, month: 2, year: 2004 })).toEqual({ day: 12, month: 2, year: 2004 });
  });
});

describe('age', () => {
  it('counts completed years, not calendar-year differences', () => {
    expect(ageOn({ day: 24, month: 8, year: 2004 }, TODAY)).toBe(22);
    // Birthday is tomorrow — still 21.
    expect(ageOn({ day: 26, month: 8, year: 2004 }, TODAY)).toBe(21);
  });

  it('turns over exactly on the birthday, not the day after', () => {
    expect(ageOn({ day: 25, month: 8, year: 2004 }, TODAY)).toBe(22);
  });

  it('handles a later month in the same year', () => {
    expect(ageOn({ day: 1, month: 12, year: 2004 }, TODAY)).toBe(21);
  });
});

describe('the year column', () => {
  it('runs newest first, because a resident is likelier to be 19 than 60', () => {
    const years = selectableYears(TODAY);
    expect(years[0]).toBe(2026 - MIN_AGE);
    expect(years[years.length - 1]).toBe(2026 - MAX_AGE);
    expect(years[0]).toBeGreaterThan(years[1]);
  });

  it('opens near a typical resident rather than on today', () => {
    // Opening on the current year would make every single user scroll.
    const opened = defaultSelection(TODAY);
    expect(opened.year).toBe(2006);
    expect(selectableYears(TODAY)).toContain(opened.year);
  });
});

describe('validation', () => {
  it('accepts a plausible resident', () => {
    const result = validateDateOfBirth({ day: 14, month: 3, year: 2004 }, TODAY);
    expect(result).toMatchObject({ ok: true, iso: '2004-03-14', age: 22 });
  });

  it('refuses nothing selected', () => {
    expect(validateDateOfBirth(null, TODAY)).toMatchObject({ ok: false, message: 'Select your date of birth' });
  });

  it('refuses a future date', () => {
    const result = validateDateOfBirth({ day: 1, month: 1, year: 2030 }, TODAY);
    expect(result.ok).toBe(false);
  });

  it('refuses someone below the minimum age, since a minor cannot sign the agreement', () => {
    const result = validateDateOfBirth({ day: 1, month: 1, year: 2020 }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(String(MIN_AGE));
  });

  it('refuses an implausible year rather than accepting a typo', () => {
    expect(validateDateOfBirth({ day: 1, month: 1, year: 1850 }, TODAY).ok).toBe(false);
  });

  it('refuses a day the month does not have', () => {
    const result = validateDateOfBirth({ day: 30, month: 2, year: 2004 }, TODAY);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('February');
  });

  it('accepts 29 February in a leap year', () => {
    expect(validateDateOfBirth({ day: 29, month: 2, year: 2004 }, TODAY).ok).toBe(true);
  });
});
