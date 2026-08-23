import { describe, it, expect } from 'vitest';
import {
  EXPORT_DOCUMENTS, documentById, periodOptions, financialYearOf,
  financialYearLabel, previewLine, customRangeError,
} from './exportDocuments';

describe('documents', () => {
  it('offers four documents named by who they are for, not by format', () => {
    // The owner has no opinion about CSV vs XLSX; he knows it is for his CA.
    expect(EXPORT_DOCUMENTS.map((d) => d.id)).toEqual([
      'accountant', 'proof_of_income', 'reconciliation', 'who_owes_me',
    ]);
    for (const d of EXPORT_DOCUMENTS) {
      expect(d.label).not.toMatch(/xlsx|csv|pdf/i);
    }
  });

  it('still tells him what he will get, in words he knows', () => {
    expect(documentById('accountant').formatLabel).toBe('Excel');
    expect(documentById('proof_of_income').formatLabel).toBe('PDF');
  });

  it('sends a bank statement as PDF and an accountant sheet as Excel', () => {
    expect(documentById('proof_of_income').format).toBe('pdf');
    expect(documentById('accountant').format).toBe('xlsx');
    expect(documentById('reconciliation').format).toBe('xlsx');
    expect(documentById('who_owes_me').format).toBe('pdf');
  });
});

describe('financial year', () => {
  it('starts in April', () => {
    expect(financialYearOf(new Date(2026, 3, 1))).toBe(2026);
    expect(financialYearOf(new Date(2026, 2, 31))).toBe(2025);
  });

  it('names the current FY the way the owner will recognise it', () => {
    const opts = periodOptions(new Date(2026, 7, 23));
    expect(opts.find((o) => o.id === 'this_fy')?.sub).toBe('2026-27 · Apr–Mar');
    expect(opts.find((o) => o.id === 'last_fy')?.sub).toBe('2025-26 · Apr–Mar');
  });

  it('gets the FY right in January, when it began last calendar year', () => {
    const opts = periodOptions(new Date(2027, 0, 15));
    expect(opts.find((o) => o.id === 'this_fy')?.sub).toBe('2026-27 · Apr–Mar');
  });

  it('formats the label like an accountant writes it', () => {
    expect(financialYearLabel(2026)).toBe('2026-27');
  });
});

describe('previewLine', () => {
  it('says what is in the file', () => {
    expect(previewLine({ count: 1247, total: 1480000, noun: 'payments' })).toBe('1,247 payments · ₹14,80,000');
  });

  it('says nothing is there in words, not as a zero', () => {
    // "0 payments · ₹0" reads like something is broken.
    expect(previewLine({ count: 0, total: 0, noun: 'payments' })).toBe('Nothing in this period yet');
  });

  it('does not say "1 payments"', () => {
    expect(previewLine({ count: 1, total: 8500, noun: 'payments' })).toBe('1 payment · ₹8,500');
  });

  it('shows nothing at all while unknown', () => {
    expect(previewLine(null)).toBeNull();
  });
});

describe('customRangeError', () => {
  it('refuses a reversed range at the control, not after a failed download', () => {
    expect(customRangeError('2026-08-31', '2026-08-01')).toMatch(/after/);
  });

  it('asks for both dates', () => {
    expect(customRangeError('2026-08-01', '')).toMatch(/both/);
  });

  it('accepts a valid range, including a single day', () => {
    expect(customRangeError('2026-08-01', '2026-08-31')).toBeNull();
    expect(customRangeError('2026-08-01', '2026-08-01')).toBeNull();
  });
});
