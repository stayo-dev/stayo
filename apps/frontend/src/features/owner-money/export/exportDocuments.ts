import type { MoneyExportId, PeriodPresetId } from './exportRequest';

/**
 * What the export sheet offers, and how it says it.
 *
 * The sheet no longer asks what the file is for. Each export lives on the Money
 * sub-tab that shows its data, so **where he tapped is the answer** — and a
 * question with only one possible answer should not be asked (ADR-197,
 * partially superseding ADR-093).
 *
 * Format is not asked either, and is not a property here: all three exports are
 * spreadsheets. An owner has no opinion about xlsx versus csv, and the person
 * he sends it to wants to sort and total it.
 *
 * Pure module, no React. Tested directly.
 */

export type MoneyExport = {
  id: MoneyExportId;
  /** The sheet's heading. Names the data, because the tab answered "what for". */
  heading: string;
  /** One line under it. */
  sub: string;
  /**
   * True where the screen already implies a period, so the sheet must not ask
   * again. Only the Expenses tab has its own date-range chips.
   */
  periodFromScreen: boolean;
};

export const MONEY_EXPORTS: Record<MoneyExportId, MoneyExport> = {
  expenses: {
    id: 'expenses',
    heading: 'Expenses',
    sub: 'The rows on this screen',
    periodFromScreen: true,
  },
  collections: {
    id: 'collections',
    heading: 'Collections',
    sub: 'What you received, and who still owes you',
    periodFromScreen: false,
  },
  finance: {
    id: 'finance',
    heading: 'Finance summary',
    sub: "Rent received, expenses and what's left — month by month",
    periodFromScreen: false,
  },
};

export function exportById(id: MoneyExportId): MoneyExport {
  const found = MONEY_EXPORTS[id];
  if (!found) throw new Error(`Unknown export: ${id}`);
  return found;
}

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
    { id: 'all_time', label: 'All time', sub: 'Everything on record' },
    { id: 'custom', label: 'Custom dates', sub: 'Pick a start and end' },
  ];
}

export type ExportPreviewData = {
  count: number;
  total: number;
  noun: string;
  secondary?: { count: number; total: number; noun: string };
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function half(count: number, total: number, noun: string): string {
  const word = count === 1 ? noun.replace(/s\b/, '') : noun;
  return `${count.toLocaleString('en-IN')} ${word} · ${rupees(total)}`;
}

/**
 * The line that says what is in the file before it is generated.
 *
 * An owner sending a year's collections to his accountant should be able to
 * tell it is the right thing without opening it. Zero rows is said plainly
 * rather than shown as "0 payments · ₹0", which reads like a fault.
 *
 * Two-sheet exports say both halves: a collections file that mentioned only
 * what came in would hide the sheet the owner most wants to check.
 */
export function previewLine(preview: ExportPreviewData | null): string | null {
  if (!preview) return null;
  if (preview.count === 0 && !preview.secondary?.count) return 'Nothing in this period yet';

  const first = preview.count === 0
    ? 'Nothing received in this period'
    : half(preview.count, preview.total, preview.noun);

  if (!preview.secondary || preview.secondary.count === 0) return first;
  return `${first} · ${half(preview.secondary.count, preview.secondary.total, preview.secondary.noun)}`;
}

/**
 * Whether the chosen range can be exported at all.
 *
 * A reversed custom range is refused here rather than sent, so the owner is
 * told by the control he just used instead of by a failed download.
 */
export function customRangeError(from: string, to: string): string | null {
  if (!from && !to) return 'Pick a start or an end date';
  if (from && to && from > to) return 'The start date is after the end date';
  return null;
}

/**
 * When the file is bigger than the screen, say so.
 *
 * The list is paginated and the export is not, so the two counts can legitimately
 * differ. An owner comparing "23 expenses" on screen against a file with 387 rows
 * has no way to tell which is wrong unless the sheet tells him.
 */
export function divergenceNote(previewCount: number, onScreenCount: number | null): string | null {
  if (onScreenCount === null || previewCount <= onScreenCount) return null;
  return `more than the ${onScreenCount.toLocaleString('en-IN')} shown on screen`;
}
