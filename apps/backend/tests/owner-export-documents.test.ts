import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  EXPORT_DOCUMENTS, EXPORT_CONTENT_TYPE, EMPTY_DOCUMENT_DATA,
  renderExpensesWorkbook, renderCollectionsWorkbook, renderFinanceWorkbook,
  exportFilename, provenance, describeExpenseFilters, RENDERERS,
  type DocumentData, type ExportDocumentId,
} from '@/src/services/exports/export-documents';
import { monthPeriod, allTimePeriod } from '@/src/services/exports/financial-year';

/**
 * Rendering is the risky half, and the half with nothing to do with a database.
 * Kept free of I/O imports it runs here without one — which in an environment
 * with no test database is the difference between real coverage and a single
 * smoke test.
 *
 * NOTE: this file imports `lib/timezone.ts` transitively (via
 * `export-documents` -> `formatIST`). That module has no imports of its own
 * today; if anything is ever added to it, this file stops being pure and the
 * pure config will start failing here.
 */

const PERIOD = monthPeriod(2026, 8); // September 2026
const GENERATED = new Date('2026-09-21T10:42:00Z'); // 4:12 pm IST

function data(over: Partial<DocumentData> = {}): DocumentData {
  return {
    period: PERIOD,
    scopeLabel: 'All hostels',
    generatedAt: GENERATED,
    ...EMPTY_DOCUMENT_DATA,
    ...over,
  };
}

const RENT = [
  { date: '2026-09-03', tenantName: 'Ravi Kumar', hostelName: 'Sunrise', amount: 8500, method: 'Cash', reference: '', source: 'owner_recorded' as const },
  { date: '2026-09-11', tenantName: 'రవి కుమార్', hostelName: 'Sunrise', amount: 12000, method: 'Online', reference: 'pay_abc123', source: 'verified' as const },
];

const EXPENSES = [
  { date: '2026-09-02', title: 'Diesel for genset', category: 'Transportation', amount: 4500, vendor: 'Sri Balaji', method: 'UPI', status: 'paid', recurring: false, hostelName: 'Sunrise', notes: 'Monsoon outage' },
  { date: '2026-09-18', title: 'Staff salary', category: 'Staff Salary', amount: 482000, vendor: '', method: 'Bank', status: 'paid', recurring: true, hostelName: 'Business (HQ)', notes: '' },
];

const OWED = {
  totalTenants: 2,
  totalOutstanding: 19000,
  rows: [
    { tenantName: 'Anil P', room: '204', hostelName: 'Sunrise', outstanding: 12000, daysOverdue: 14, priority: 'Needs attention', phone: '9876543210', lastPaymentAt: '2026-07-05' },
    { tenantName: 'Sita R', room: '108', hostelName: 'Sunrise', outstanding: 7000, daysOverdue: 0, priority: 'Due today', phone: '', lastPaymentAt: '' },
  ],
};

async function open(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as any);
  return wb;
}

describe('the catalogue', () => {
  it('offers exactly three exports, named by the data they contain', () => {
    expect(Object.keys(EXPORT_DOCUMENTS)).toEqual(['expenses', 'collections', 'finance']);
  });

  it('never asks what format you want — every export is a spreadsheet', () => {
    // A regression guard for ADR-197: format is not a per-document decision any
    // more, so no entry may carry one.
    for (const doc of Object.values(EXPORT_DOCUMENTS)) {
      expect('format' in doc).toBe(false);
    }
    expect(EXPORT_CONTENT_TYPE).toContain('spreadsheetml.sheet');
  });

  it('never mentions a file format in the label an owner reads', () => {
    for (const doc of Object.values(EXPORT_DOCUMENTS)) {
      expect(`${doc.label} ${doc.sub}`.toLowerCase()).not.toMatch(/xlsx|csv|pdf|excel/);
    }
  });

  it('has a renderer for every document, and no orphans', () => {
    expect(Object.keys(RENDERERS).sort()).toEqual(Object.keys(EXPORT_DOCUMENTS).sort());
  });
});

describe('exportFilename', () => {
  it('names the file after the data and the period', () => {
    expect(exportFilename({ document: 'expenses', period: PERIOD }))
      .toBe('expenses-2026-09-01-to-2026-09-30.xlsx');
    expect(exportFilename({ document: 'collections', period: PERIOD }))
      .toBe('rent-collections-2026-09-01-to-2026-09-30.xlsx');
  });

  it('never invents a start date for an all-time export', () => {
    expect(exportFilename({ document: 'expenses', period: allTimePeriod(GENERATED) }))
      .toBe('expenses-all-time-to-2026-09-21.xlsx');
  });
});

describe('every document renders', () => {
  const cases: [ExportDocumentId, (d: DocumentData) => Promise<Uint8Array>][] = [
    ['expenses', renderExpensesWorkbook],
    ['collections', renderCollectionsWorkbook],
    ['finance', renderFinanceWorkbook],
  ];

  for (const [id, render] of cases) {
    it(`${id} produces a real workbook with rows`, async () => {
      const bytes = await render(data({ rent: RENT, expenses: EXPENSES, owed: OWED }));
      expect(bytes.length).toBeGreaterThan(1000);
      expect(Buffer.from(bytes.slice(0, 2)).toString()).toBe('PK'); // xlsx is a zip
    });

    it(`${id} still renders when there is nothing in the period`, async () => {
      // An owner with an empty month gets a valid file that says so, not a crash.
      const bytes = await render(data());
      expect(Buffer.from(bytes.slice(0, 2)).toString()).toBe('PK');
    });
  }
});

describe('a proper spreadsheet, not a dump', () => {
  it('writes dates as real date cells, so they sort and filter', async () => {
    const wb = await open(await renderExpensesWorkbook(data({ expenses: EXPENSES })));
    const cell = wb.getWorksheet('Expenses')!.getRow(2).getCell(1);
    expect(cell.value).toBeInstanceOf(Date);
    expect(cell.numFmt).toBe('dd-mmm-yyyy');
  });

  it('puts the date at noon, so no timezone can shift it a day', async () => {
    // ExcelJS serialises through the host's local offset; a midnight date lands
    // on the wrong day on either side of UTC.
    const wb = await open(await renderExpensesWorkbook(data({ expenses: EXPENSES })));
    const cell = wb.getWorksheet('Expenses')!.getRow(2).getCell(1).value as Date;
    expect(cell.getFullYear()).toBe(2026);
    expect(cell.getMonth()).toBe(8);
    expect(cell.getDate()).toBe(2);
  });

  it('writes amounts as numbers with an Indian currency format', async () => {
    const wb = await open(await renderExpensesWorkbook(data({ expenses: EXPENSES })));
    const cell = wb.getWorksheet('Expenses')!.getRow(3).getCell(4);
    // A number, never a pre-formatted string — a string cannot be summed.
    expect(cell.value).toBe(482000);
    // Lakh grouping: 482000 reads as ₹4,82,000, not ₹482,000.
    expect(cell.numFmt).toContain('#,##,##0');
    expect(cell.numFmt).toContain('₹');
  });

  it('freezes the header and turns on filter arrows', async () => {
    const wb = await open(await renderExpensesWorkbook(data({ expenses: EXPENSES })));
    const sheet = wb.getWorksheet('Expenses')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it('totals with a live SUM formula, not a number Stayo asserts', async () => {
    const wb = await open(await renderExpensesWorkbook(data({ expenses: EXPENSES })));
    const sheet = wb.getWorksheet('Expenses')!;
    const total = sheet.getRow(sheet.rowCount).getCell(4).value as any;
    expect(total.formula).toBe('SUM(D2:D3)');
  });

  it('writes a plain zero rather than a broken formula when there are no rows', async () => {
    const wb = await open(await renderExpensesWorkbook(data()));
    const sheet = wb.getWorksheet('Expenses')!;
    expect(sheet.getRow(sheet.rowCount).getCell(4).value).toBe(0);
  });

  it('keeps the rupee sign and a non-Latin name intact', async () => {
    // The inverse of the old PDF rule. pdf-lib's WinAnsi fonts could encode
    // neither ₹ nor Telugu, so `pdfSafe` turned "రవి కుమార్" into "????????".
    // A spreadsheet is UTF-8 and needs no such mangling.
    const wb = await open(await renderCollectionsWorkbook(data({ rent: RENT, owed: OWED })));
    const names = wb.getWorksheet('Received')!.getColumn(2).values.map(String);
    expect(names).toContain('రవి కుమార్');
  });
});

describe('where money came from', () => {
  /**
   * ADR-094's successor. The proof-of-income PDF kept verified and
   * self-reported money in separate sections so a lender could not read one as
   * the other. That document is gone; this column carries the distinction on
   * every rent row instead, in both documents that show rent.
   */
  for (const [name, render, sheetName] of [
    ['collections', renderCollectionsWorkbook, 'Received'],
    ['finance', renderFinanceWorkbook, 'Rent received'],
  ] as const) {
    it(`${name} marks every rent row's provenance`, async () => {
      const wb = await open(await render(data({ rent: RENT, expenses: EXPENSES, owed: OWED })));
      const sheet = wb.getWorksheet(sheetName)!;
      expect(sheet.getRow(1).values).toContain('How it reached you');
      const col = sheet.getColumn(7).values.map(String);
      expect(col).toContain('Through Stayo (verified)');
      expect(col).toContain('Paid to you directly');
    });
  }
});

describe('the Still owed sheet', () => {
  it('says it is about now, not about the export period', async () => {
    const wb = await open(await renderCollectionsWorkbook(data({ rent: RENT, owed: OWED })));
    const note = String(wb.getWorksheet('Still owed')!.getRow(1).getCell(1).value);
    expect(note).toContain('As at');
    expect(note).toContain('this sheet is about now');
    expect(note).not.toContain(PERIOD.label);
  });

  it('carries the queue priority so the list can be worked top-down', async () => {
    const wb = await open(await renderCollectionsWorkbook(data({ rent: RENT, owed: OWED })));
    expect(wb.getWorksheet('Still owed')!.getColumn(6).values.map(String))
      .toContain('Needs attention');
  });
});

describe('the finance workbook', () => {
  it('shows rent, expenses and the subtraction month by month', async () => {
    const wb = await open(await renderFinanceWorkbook(data({ rent: RENT, expenses: EXPENSES })));
    const sheet = wb.getWorksheet('Month by month')!;
    expect(sheet.getRow(1).values).toContain('Net (INR)');
    expect(sheet.getRow(2).getCell(1).value).toBe('2026-09');
    expect(sheet.getRow(2).getCell(2).value).toBe(20500);   // 8500 + 12000
    expect(sheet.getRow(2).getCell(3).value).toBe(486500);  // 4500 + 482000
    expect(sheet.getRow(2).getCell(4).value).toBe(-466000);
  });

  it('never calls it profit', async () => {
    // Owner-facing vocabulary: the screen says "what's left", the accountant's
    // sheet says "Net". Neither says profit — nothing here is profit.
    const wb = await open(await renderFinanceWorkbook(data({ rent: RENT, expenses: EXPENSES })));
    const headers = String(wb.getWorksheet('Month by month')!.getRow(1).values).toLowerCase();
    expect(headers).not.toContain('profit');
  });
});

describe('provenance', () => {
  const row = (rows: string[][], key: string) => rows.find((r) => r[0] === key)?.[1];

  it('stamps the time in IST, whatever timezone the server is in', () => {
    // toLocaleString without a timeZone resolves to the PROCESS timezone, so a
    // UTC host would label a UTC time with Indian formatting — a real bug once.
    const rows = provenance({
      title: 'Expenses', period: PERIOD, scopeLabel: 'All hostels', filterLabels: [],
      count: 2, total: 486500, generatedAt: GENERATED,
    });
    expect(row(rows, 'Generated')).toBe('21 Sept 2026, 4:12 pm');
  });

  it('is still IST when the instant is already tomorrow in India', () => {
    const rows = provenance({
      title: 'Expenses', period: PERIOD, scopeLabel: 'All hostels', filterLabels: [],
      count: 0, total: 0, generatedAt: new Date('2026-09-21T19:30:00Z'), // 1:00 am on the 22nd IST
    });
    expect(row(rows, 'Generated')).toContain('22 Sept 2026');
  });

  it('says what an all-time file actually covers', () => {
    // A file headed "All time" whose earliest row is 2024 states both, rather
    // than leaving the reader to wonder which is wrong.
    const rows = provenance({
      title: 'Expenses', period: allTimePeriod(GENERATED), scopeLabel: 'All hostels',
      filterLabels: [], count: 2, total: 1, generatedAt: GENERATED,
      coverage: { first: '2024-03-12', last: '2026-09-19' },
    });
    expect(row(rows, 'Period')).toBe('All time (up to 21 Sep 2026)');
    expect(row(rows, 'Covers')).toBe('12 Mar 2024 – 19 Sep 2026');
  });

  it('says plainly when nothing was filtered out', () => {
    const rows = provenance({
      title: 'Expenses', period: PERIOD, scopeLabel: 'All hostels', filterLabels: [],
      count: 2, total: 1, generatedAt: GENERATED,
    });
    expect(row(rows, 'Filters')).toBe('None — everything in the period');
  });

  it('lists each filter that narrowed the file', () => {
    const rows = provenance({
      title: 'Expenses', period: PERIOD, scopeLabel: 'Sunrise',
      filterLabels: ['Search: diesel', 'Status: Paid'],
      count: 1, total: 4500, generatedAt: GENERATED,
    });
    expect(rows.filter((r) => r[1].startsWith('Search') || r[1].startsWith('Status'))).toHaveLength(2);
  });

  it('announces truncation rather than handing over a file that looks complete', () => {
    const rows = provenance({
      title: 'Expenses', period: PERIOD, scopeLabel: 'All hostels', filterLabels: [],
      count: 20000, total: 1, generatedAt: GENERATED, truncatedFrom: 61204,
    });
    expect(row(rows, 'Rows shown')).toBe('20,000 of 61,204');
    expect(row(rows, 'Rows')).toBeUndefined();
  });

  it('reaches the Report sheet of every document', async () => {
    const wb = await open(await renderExpensesWorkbook(data({ expenses: EXPENSES })));
    const sheet = wb.getWorksheet('Report')!;
    const keys = sheet.getColumn(1).values.map(String);
    expect(keys).toContain('Period');
    expect(keys).toContain('Generated');
    expect(keys).toContain('Source');
  });
});

describe('describeExpenseFilters', () => {
  it('says nothing when nothing is filtered', () => {
    expect(describeExpenseFilters({})).toEqual([]);
  });

  it('puts each filter in words, in a stable order', () => {
    expect(describeExpenseFilters({
      search: 'diesel', status: 'partially_paid', vendor: 'Sri Balaji',
      paymentMethod: 'UPI', amountMin: 5000, recurring: true,
    })).toEqual([
      'Search: diesel',
      'Status: Partially paid',
      'Vendor: Sri Balaji',
      'Paid by: UPI',
      '₹5,000 and above',
      'Recurring only',
    ]);
  });

  it('describes a bounded amount range as one phrase, not two', () => {
    expect(describeExpenseFilters({ amountMin: 100, amountMax: 900 }))
      .toEqual(['Between ₹100 and ₹900']);
  });

  it('distinguishes recurring from one-time', () => {
    expect(describeExpenseFilters({ recurring: false })).toEqual(['One-time only']);
  });
});
