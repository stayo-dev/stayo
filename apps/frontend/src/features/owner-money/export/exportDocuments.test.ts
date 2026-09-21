import { describe, it, expect } from 'vitest';
import {
  MONEY_EXPORTS, exportById, periodOptions, previewLine, customRangeError,
  financialYearOf, financialYearLabel,
} from './exportDocuments';

describe('the three exports', () => {
  it('are named by the data they contain', () => {
    expect(Object.keys(MONEY_EXPORTS)).toEqual(['expenses', 'collections', 'finance']);
  });

  it('never mention a file format', () => {
    // The owner has no opinion about xlsx versus csv, and saying so in the UI
    // would put the question back that ADR-197 removed.
    for (const doc of Object.values(MONEY_EXPORTS)) {
      expect(`${doc.heading} ${doc.sub}`.toLowerCase()).not.toMatch(/xlsx|csv|pdf|excel|spreadsheet/);
    }
  });

  it('carry no format field at all', () => {
    // A regression guard: format is not a per-document decision any more.
    for (const doc of Object.values(MONEY_EXPORTS)) {
      expect('format' in doc).toBe(false);
      expect('formatLabel' in doc).toBe(false);
    }
  });

  it('takes its period from the screen only where the screen has one', () => {
    // The Expenses tab has date-range chips; Collections and Overview do not.
    expect(MONEY_EXPORTS.expenses.periodFromScreen).toBe(true);
    expect(MONEY_EXPORTS.collections.periodFromScreen).toBe(false);
    expect(MONEY_EXPORTS.finance.periodFromScreen).toBe(false);
  });

  it('never says "profit", and never says "settlement"', () => {
    const copy = Object.values(MONEY_EXPORTS).map((d) => `${d.heading} ${d.sub}`).join(' ').toLowerCase();
    expect(copy).not.toContain('profit');
    expect(copy).not.toContain('settlement');
  });

  it('refuses an id it does not have', () => {
    expect(() => exportById('accountant' as any)).toThrow(/Unknown export/);
  });
});

describe('financial year', () => {
  it('starts in April, not January', () => {
    expect(financialYearOf(new Date('2026-04-01'))).toBe(2026);
    expect(financialYearOf(new Date('2026-03-31'))).toBe(2025);
  });

  it('puts January in the FY that began the previous calendar year', () => {
    expect(financialYearOf(new Date('2027-01-15'))).toBe(2026);
  });

  it('labels the year the way an accountant writes it', () => {
    expect(financialYearLabel(2026)).toBe('2026-27');
  });
});

describe('periodOptions', () => {
  it('offers every period the sheet can ask for', () => {
    expect(periodOptions(new Date('2026-09-21')).map((p) => p.id)).toEqual([
      'this_month', 'last_month', 'this_fy', 'last_fy', 'all_time', 'custom',
    ]);
  });

  it('names the financial years so the owner can recognise them', () => {
    const opts = periodOptions(new Date('2026-09-21'));
    expect(opts.find((p) => p.id === 'this_fy')?.sub).toBe('2026-27 · Apr–Mar');
    expect(opts.find((p) => p.id === 'last_fy')?.sub).toBe('2025-26 · Apr–Mar');
  });
});

describe('previewLine', () => {
  it('says what is in the file, with thousands grouped the Indian way', () => {
    expect(previewLine({ count: 1247, total: 1480000, noun: 'payments' }))
      .toBe('1,247 payments · ₹14,80,000');
  });

  it('says nothing is there plainly, rather than showing "0 payments · ₹0"', () => {
    expect(previewLine({ count: 0, total: 0, noun: 'payments' })).toBe('Nothing in this period yet');
  });

  it('singularises a count of one', () => {
    expect(previewLine({ count: 1, total: 8500, noun: 'payments' })).toBe('1 payment · ₹8,500');
  });

  it('says both halves of a two-sheet export', () => {
    // A collections line mentioning only what came in would hide the sheet the
    // owner most wants to check.
    expect(previewLine({
      count: 142, total: 482000, noun: 'payments',
      secondary: { count: 9, total: 112000, noun: 'tenants still owe' },
    })).toBe('142 payments · ₹4,82,000 · 9 tenants still owe · ₹1,12,000');
  });

  it('still reports the second half when the first is empty', () => {
    expect(previewLine({
      count: 0, total: 0, noun: 'payments',
      secondary: { count: 9, total: 112000, noun: 'tenants still owe' },
    })).toBe('Nothing received in this period · 9 tenants still owe · ₹1,12,000');
  });

  it('drops the second half when it is empty', () => {
    expect(previewLine({
      count: 142, total: 482000, noun: 'payments',
      secondary: { count: 0, total: 0, noun: 'tenants still owe' },
    })).toBe('142 payments · ₹4,82,000');
  });

  it('has nothing to say before the answer arrives', () => {
    expect(previewLine(null)).toBeNull();
  });
});

describe('customRangeError', () => {
  it('refuses a reversed range', () => {
    expect(customRangeError('2026-09-30', '2026-09-01')).toBe('The start date is after the end date');
  });

  it('refuses a range with neither end', () => {
    expect(customRangeError('', '')).toBe('Pick a start or an end date');
  });

  it('accepts a one-sided range', () => {
    expect(customRangeError('', '2026-09-12')).toBeNull();
    expect(customRangeError('2026-03-01', '')).toBeNull();
  });

  it('accepts a valid single-day range', () => {
    expect(customRangeError('2026-09-12', '2026-09-12')).toBeNull();
  });
});
