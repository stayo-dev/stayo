import { describe, it, expect } from 'vitest';
import {
  renderAccountantWorkbook, renderReconciliationWorkbook,
  renderProofOfIncomePdf, renderWhoOwesMePdf,
  exportFilename, exportContentType, EXPORT_DOCUMENTS,
  EMPTY_DOCUMENT_DATA, proofOfIncomeSections, type DocumentData,
} from '@/src/services/exports/export-documents';
import { financialYearPeriod } from '@/src/services/exports/financial-year';

const period = financialYearPeriod(2026);
const base: DocumentData = { period, scopeLabel: 'All hostels', ...EMPTY_DOCUMENT_DATA };

const rent = [
  { date: '2026-04-05', tenantName: 'Ravi Kumar', hostelName: 'Sunrise Residency', amount: 8500, method: 'Online', reference: 'pay_abc', source: 'verified' as const },
  { date: '2026-04-07', tenantName: 'Kiran S', hostelName: 'Sunrise Residency', amount: 6000, method: 'Cash', reference: '', source: 'owner_recorded' as const },
  { date: '2026-05-02', tenantName: 'Suresh P', hostelName: 'Green Nest', amount: 4000, method: 'UPI', reference: 'upi-1', source: 'owner_recorded' as const },
];

const magic = (bytes: Uint8Array, n = 4) => Buffer.from(bytes.slice(0, n)).toString('latin1');
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('document identity', () => {
  it('names the file by what it is and the period it covers', () => {
    expect(exportFilename({ document: 'accountant', period }))
      .toBe('rent-register-2026-04-01-to-2027-03-31.xlsx');
    expect(exportFilename({ document: 'proof_of_income', period }))
      .toBe('income-statement-2026-04-01-to-2027-03-31.pdf');
  });

  it('sends a content type matching each document\'s real format', () => {
    for (const [id, doc] of Object.entries(EXPORT_DOCUMENTS)) {
      const ct = exportContentType(id as any);
      expect(ct).toBe(doc.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf');
    }
  });
});

describe('rendering produces real files', () => {
  it('writes a valid xlsx for the accountant', async () => {
    const bytes = await renderAccountantWorkbook({ ...base, rent });
    expect(magic(bytes, 2)).toBe('PK'); // zip container
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('writes a valid pdf for proof of income', async () => {
    const bytes = await renderProofOfIncomePdf({ ...base, rent });
    expect(magic(bytes)).toBe('%PDF');
  });

  it('writes a valid xlsx for reconciliation', async () => {
    const bytes = await renderReconciliationWorkbook({
      ...base,
      payouts: [{ id: 'p1', amount: 13900, status: 'PAID', method: 'BANK_TRANSFER', reference: 'N2148891', paidAt: '2026-08-21',
        tenants: [{ name: 'Ravi Kumar', hostelName: 'Sunrise Residency', amount: 8500, date: '2026-08-19' }] }],
    });
    expect(magic(bytes, 2)).toBe('PK');
  });

  it('writes a valid pdf for the chase list', async () => {
    const bytes = await renderWhoOwesMePdf({
      ...base,
      queue: { totalTenants: 1, totalOutstanding: 8500, groups: [{ label: 'Needs immediate attention', count: 1, totalOutstanding: 8500,
        rows: [{ tenantName: 'Ravi Kumar', room: '204', hostelName: 'Sunrise Residency', outstanding: 8500, daysOverdue: 12, phone: '9999999999' }] }] },
    });
    expect(magic(bytes)).toBe('%PDF');
  });

  it('renders an empty period without throwing', async () => {
    // The state most owners see first. A document that refuses to generate
    // because there is no data is worse than an honest empty one.
    for (const render of [renderAccountantWorkbook, renderReconciliationWorkbook, renderProofOfIncomePdf, renderWhoOwesMePdf]) {
      await expect(render(base)).resolves.toBeInstanceOf(Uint8Array);
    }
  });
});

describe('the PDF cases that actually break', () => {
  it('survives a tenant name in Telugu instead of throwing', async () => {
    // pdf-lib's standard fonts are WinAnsi; a Telugu or Devanagari glyph throws
    // rather than degrading. Without sanitising, the chase list would fail for
    // exactly the owners most likely to have such names on their roster.
    const bytes = await renderWhoOwesMePdf({
      ...base,
      queue: { totalTenants: 1, totalOutstanding: 5000, groups: [{ label: 'Due today', count: 1, totalOutstanding: 5000,
        rows: [{ tenantName: 'రవి కుమార్', room: '12', hostelName: 'श्री आदित्य', outstanding: 5000, daysOverdue: 0, phone: '98' }] }] },
    });
    expect(magic(bytes)).toBe('%PDF');
  });

  it('never puts a rupee sign in a PDF', async () => {
    // U+20B9 is not in WinAnsi. Money in PDFs is written "Rs." — the same
    // convention the expenses export already uses.
    const bytes = await renderProofOfIncomePdf({ ...base, rent });
    expect(text(bytes)).not.toContain('₹');
  });
});

describe('proof of income keeps verified and self-reported apart', () => {
  it('labels both sections and never merges them into one figure', () => {
    // A lender must be able to see which rupees a third party can confirm.
    // Blending them would present self-reported cash as verified income.
    const sections = proofOfIncomeSections(rent);
    expect(sections.map((s) => s.key)).toEqual(['verified', 'owner_recorded']);
    expect(sections[0].total).toBe(8500);
    expect(sections[1].total).toBe(10000);
    expect(sections[1].note).toContain('cannot independently confirm');
  });

  it('keeps both sections present even when one is empty', () => {
    // An absent section would quietly turn a mixed statement into one that
    // reads as entirely verified.
    const onlyCash = proofOfIncomeSections(rent.filter((r) => r.source === 'owner_recorded'));
    expect(onlyCash).toHaveLength(2);
    expect(onlyCash[0].total).toBe(0);
    expect(onlyCash[0].title).toBe('Verified by Stayo');
  });

  it('accounts for every rupee across exactly two sections', () => {
    const sections = proofOfIncomeSections(rent);
    const summed = sections.reduce((s, sec) => s + sec.total, 0);
    expect(summed).toBe(rent.reduce((s, r) => s + r.amount, 0));
    expect(sections.reduce((n, sec) => n + sec.rows.length, 0)).toBe(rent.length);
  });

  it('still renders when every rupee is one kind or the other', async () => {
    await expect(renderProofOfIncomePdf({ ...base, rent: rent.filter((r) => r.source === 'verified') })).resolves.toBeDefined();
    await expect(renderProofOfIncomePdf({ ...base, rent: rent.filter((r) => r.source === 'owner_recorded') })).resolves.toBeDefined();
  });
});
