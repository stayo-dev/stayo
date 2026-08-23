/**
 * What the export sheet offers, and how it says it.
 *
 * The sheet asks **who this is for**, not what format you want. Every export an
 * owner makes is handed to somebody else — an accountant, a bank officer, a
 * partner, a manager — and he has no opinion about CSV versus XLSX. He knows
 * it is for his accountant. Format is a consequence of that answer, decided
 * here, not a decision he has to carry.
 *
 * Pure module, no React. Tested directly.
 */

export type ExportDocumentId = 'accountant' | 'proof_of_income' | 'reconciliation' | 'who_owes_me';
export type ExportFormat = 'xlsx' | 'pdf';

export type ExportDocument = {
  id: ExportDocumentId;
  label: string;
  sub: string;
  format: ExportFormat;
  /** What the format means to someone who does not know what xlsx is. */
  formatLabel: string;
};

export const EXPORT_DOCUMENTS: ExportDocument[] = [
  {
    id: 'accountant',
    label: 'For my accountant',
    sub: 'Rent received and expenses, month by month',
    format: 'xlsx',
    formatLabel: 'Excel',
  },
  {
    id: 'proof_of_income',
    label: 'Proof of income',
    sub: 'For a bank, landlord or partner',
    format: 'pdf',
    formatLabel: 'PDF',
  },
  {
    id: 'reconciliation',
    label: 'Bank reconciliation',
    sub: 'Payouts with references, and who paid each one',
    format: 'xlsx',
    formatLabel: 'Excel',
  },
  {
    id: 'who_owes_me',
    label: 'Who owes me',
    sub: 'Printable list to chase or hand over',
    format: 'pdf',
    formatLabel: 'PDF',
  },
];

export type PeriodPresetId = 'this_month' | 'last_month' | 'this_fy' | 'last_fy' | 'custom';

const FY_START_MONTH = 3; // April

/**
 * The financial year a date falls in, named by the calendar year it started.
 *
 * India's financial year is April–March. Presented wrong, an export handed to
 * an accountant covers the wrong twelve months and nobody notices until he
 * calls in July. The backend resolves the actual dates — this only has to name
 * them correctly in the picker.
 */
export function financialYearOf(now: Date): number {
  const y = now.getFullYear();
  return now.getMonth() >= FY_START_MONTH ? y : y - 1;
}

export function financialYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export type PeriodOption = { id: PeriodPresetId; label: string; sub: string };

export function periodOptions(now: Date = new Date()): PeriodOption[] {
  const fy = financialYearOf(now);
  const monthName = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };
  return [
    { id: 'this_month', label: 'This month', sub: monthName(0) },
    { id: 'last_month', label: 'Last month', sub: monthName(-1) },
    { id: 'this_fy', label: 'This financial year', sub: `${financialYearLabel(fy)} · Apr–Mar` },
    { id: 'last_fy', label: 'Last financial year', sub: `${financialYearLabel(fy - 1)} · Apr–Mar` },
    { id: 'custom', label: 'Custom dates', sub: 'Pick a start and end' },
  ];
}

export function documentById(id: ExportDocumentId): ExportDocument {
  const found = EXPORT_DOCUMENTS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown export document: ${id}`);
  return found;
}

/**
 * The line that says what is in the file before it is generated.
 *
 * An owner sending a year's rent register to his accountant should be able to
 * tell it is the right thing without opening it. Zero rows is said plainly
 * rather than shown as "0 payments · ₹0", which reads like a fault.
 */
export function previewLine(preview: { count: number; total: number; noun: string } | null): string | null {
  if (!preview) return null;
  if (preview.count === 0) return 'Nothing in this period yet';
  const amount = `₹${Math.round(preview.total).toLocaleString('en-IN')}`;
  const noun = preview.count === 1 ? preview.noun.replace(/s$/, '') : preview.noun;
  return `${preview.count.toLocaleString('en-IN')} ${noun} · ${amount}`;
}

/**
 * Whether the chosen range can be exported at all.
 *
 * A reversed custom range is refused here rather than sent, so the owner is
 * told by the control he just used instead of by a failed download.
 */
export function customRangeError(from: string, to: string): string | null {
  if (!from || !to) return 'Pick both a start and an end date';
  if (from > to) return 'The start date is after the end date';
  return null;
}
