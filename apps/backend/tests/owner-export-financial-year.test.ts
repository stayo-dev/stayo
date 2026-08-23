import { describe, it, expect } from 'vitest';
import {
  financialYearOf, financialYearLabel, financialYearPeriod,
  monthPeriod, resolvePreset, customPeriod, periodPresets,
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
    expect(customPeriod('2026-04-01', '2026-09-30').label).toBe('Apr 2026 – Sep 2026');
  });
});
