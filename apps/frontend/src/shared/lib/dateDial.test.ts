import { describe, it, expect } from 'vitest';
import {
  parseIso,
  toIso,
  daysInMonth,
  clampParts,
  clampToRange,
  buildYearOptions,
  buildMonthOptions,
  buildDayOptions,
  formatDateParts,
} from './dateDial';

describe('parseIso / toIso', () => {
  it('round-trips a real date', () => {
    const parts = parseIso('2026-08-05');
    expect(parts).toEqual({ year: 2026, month: 8, day: 5 });
    expect(toIso(parts!)).toBe('2026-08-05');
  });

  it('pads single digits, so the value stays a valid ISO date', () => {
    expect(toIso({ year: 2026, month: 1, day: 9 })).toBe('2026-01-09');
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // `new Date(2026, 1, 30)` silently becomes 2 March. A tenancy start date
    // must never move on its own.
    expect(parseIso('2026-02-30')).toBeNull();
    expect(parseIso('2026-13-01')).toBeNull();
    expect(parseIso('2026-00-10')).toBeNull();
  });

  it('refuses anything that is not a plain ISO date', () => {
    expect(parseIso('')).toBeNull();
    expect(parseIso('05/08/2026')).toBeNull();
    expect(parseIso(null)).toBeNull();
  });
});

describe('daysInMonth', () => {
  it('knows the short months', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('gets leap years right, including the century rules', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe('clampParts', () => {
  it('pulls 31 back to the end of a shorter month', () => {
    // The bug this exists for: turning the month dial from January to February
    // while the day dial sits on 31.
    expect(clampParts({ year: 2026, month: 2, day: 31 })).toEqual({ year: 2026, month: 2, day: 28 });
    expect(clampParts({ year: 2028, month: 2, day: 31 })).toEqual({ year: 2028, month: 2, day: 29 });
    expect(clampParts({ year: 2026, month: 4, day: 31 })).toEqual({ year: 2026, month: 4, day: 30 });
  });

  it('leaves a date that is already real alone', () => {
    expect(clampParts({ year: 2026, month: 8, day: 5 })).toEqual({ year: 2026, month: 8, day: 5 });
  });

  it('never produces a day or month below one', () => {
    expect(clampParts({ year: 2026, month: 0, day: 0 })).toEqual({ year: 2026, month: 1, day: 1 });
  });
});

describe('clampToRange', () => {
  const max = { year: 2026, month: 8, day: 29 };
  const min = { year: 2024, month: 1, day: 1 };

  it('pulls a date past the maximum back to it', () => {
    expect(clampToRange({ year: 2027, month: 1, day: 5 }, min, max)).toEqual(max);
  });

  it('pushes a date before the minimum up to it', () => {
    expect(clampToRange({ year: 2020, month: 5, day: 5 }, min, max)).toEqual(min);
  });

  it('leaves a date inside the range untouched', () => {
    const inside = { year: 2025, month: 6, day: 10 };
    expect(clampToRange(inside, min, max)).toEqual(inside);
  });

  it('treats both bounds as inclusive', () => {
    expect(clampToRange(max, min, max)).toEqual(max);
    expect(clampToRange(min, min, max)).toEqual(min);
  });

  it('still fixes an impossible day when there are no bounds', () => {
    expect(clampToRange({ year: 2026, month: 2, day: 31 }, null, null)).toEqual({
      year: 2026, month: 2, day: 28,
    });
  });
});

describe('buildYearOptions', () => {
  it('spans the bounds when both are given', () => {
    expect(buildYearOptions({ year: 2024, month: 1, day: 1 }, { year: 2026, month: 8, day: 29 }, 2026)).toEqual([
      2024, 2025, 2026,
    ]);
  });

  it('offers a sensible span when a bound is open', () => {
    const years = buildYearOptions(null, { year: 2026, month: 8, day: 29 }, 2026);
    expect(years[years.length - 1]).toBe(2026);
    expect(years).toContain(1996);
  });

  it('never returns an empty dial', () => {
    expect(buildYearOptions({ year: 2030, month: 1, day: 1 }, { year: 2020, month: 1, day: 1 }, 2026)).toEqual([2026]);
  });
});

describe('buildMonthOptions', () => {
  const max = { year: 2026, month: 8, day: 29 };

  it('stops at the maximum month in the maximum year', () => {
    // "When did they move in?" is capped at today, so December 2026 must not
    // be offerable in August 2026.
    expect(buildMonthOptions(2026, null, max)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('offers the whole year below the maximum year', () => {
    expect(buildMonthOptions(2025, null, max)).toHaveLength(12);
  });

  it('starts at the minimum month in the minimum year', () => {
    expect(buildMonthOptions(2024, { year: 2024, month: 6, day: 1 }, max)).toEqual([6, 7, 8, 9, 10, 11, 12]);
  });
});

describe('buildDayOptions', () => {
  const max = { year: 2026, month: 8, day: 29 };

  it('stops at the maximum day in the maximum month', () => {
    expect(buildDayOptions(2026, 8, null, max)).toHaveLength(29);
  });

  it('offers the whole month elsewhere, respecting its length', () => {
    expect(buildDayOptions(2026, 7, null, max)).toHaveLength(31);
    expect(buildDayOptions(2026, 2, null, max)).toHaveLength(28);
    expect(buildDayOptions(2028, 2, null, null)).toHaveLength(29);
  });

  it('never offers a day beyond the real length of the month', () => {
    // A max of the 31st in a 30-day month must not produce a 31st.
    expect(buildDayOptions(2026, 4, null, { year: 2026, month: 4, day: 31 })).toHaveLength(30);
  });

  it('starts at the minimum day in the minimum month', () => {
    expect(buildDayOptions(2024, 6, { year: 2024, month: 6, day: 15 }, max)[0]).toBe(15);
  });
});

describe('formatDateParts', () => {
  it('reads the date the way it is said, with the month as a word', () => {
    // The whole point: "05/08/2026" is ambiguous, "5 August 2026" is not.
    expect(formatDateParts({ year: 2026, month: 8, day: 5 })).toBe('5 August 2026');
  });

  it('is empty when nothing is chosen', () => {
    expect(formatDateParts(null)).toBe('');
  });
});
