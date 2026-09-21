import ExcelJS from "exceljs";
import { formatIST } from "@/lib/timezone";
import { isAllTime, prettyDate, periodSlug, type Period } from "./financial-year";

/**
 * The three exports an owner actually needs, rendered from already-fetched rows.
 *
 * Each is named by the DATA it contains, and each is reachable only from the
 * Money sub-tab that shows that data — so "what is this for?" is answered by
 * where he tapped and never asked (ADR-197, partially superseding ADR-093).
 *
 * All three are spreadsheets. Nothing here renders a PDF: the four
 * audience-named documents that needed one are gone, and with them `pdfSafe`,
 * which used to replace a Telugu tenant name with question marks because
 * pdf-lib's standard fonts could not encode it.
 *
 * **No I/O.** Rendering is kept free of any import that reaches a database so
 * it runs under `vitest.pure.config.ts` — which in an environment with no test
 * database is the difference between real coverage and none at all. Fetching
 * lives next door in `owner-money-export-service.ts`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** One rent receipt, tagged by whether a third party can confirm it. */
export type RentReceivedRow = {
  date: string;
  tenantName: string;
  hostelName: string;
  amount: number;
  method: string;
  reference: string;
  source: "verified" | "owner_recorded";
};

export type ExpenseRow = {
  date: string;
  title: string;
  category: string;
  amount: number;
  vendor: string;
  method: string;
  status: string;
  recurring: boolean;
  hostelName: string;
  notes: string;
};

export type OwedRow = {
  tenantName: string;
  room: string;
  hostelName: string;
  outstanding: number;
  daysOverdue: number;
  priority: string;
  phone: string;
  lastPaymentAt: string;
};

export type ExportDocumentId = "expenses" | "collections" | "finance";

export const EXPORT_DOCUMENTS: Record<ExportDocumentId, { label: string; sub: string; stem: string }> = {
  expenses: {
    label: "Expenses",
    sub: "The rows on this screen",
    stem: "expenses",
  },
  collections: {
    label: "Collections",
    sub: "What you received, and who still owes you",
    stem: "rent-collections",
  },
  finance: {
    label: "Finance summary",
    sub: "Rent received, expenses and what's left",
    stem: "finance-summary",
  },
};

/** One content type, because format is no longer a per-document decision. */
export const EXPORT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Everything a document needs, already fetched. */
export type DocumentData = {
  period: Period;
  scopeLabel: string;
  /** Human-readable list of the filters that narrowed this file; [] if none. */
  filterLabels: string[];
  /** Injected rather than read from the clock, so provenance is testable. */
  generatedAt: Date;
  rent: RentReceivedRow[];
  expenses: ExpenseRow[];
  owed: { totalTenants: number; totalOutstanding: number; rows: OwedRow[] };
  /** Set only when a row cap bit, so truncation announces itself. */
  truncatedFrom?: number | null;
};

export const EMPTY_DOCUMENT_DATA: Omit<DocumentData, "period" | "scopeLabel" | "generatedAt"> = {
  filterLabels: [],
  rent: [],
  expenses: [],
  owed: { totalTenants: 0, totalOutstanding: 0, rows: [] },
};

// ─────────────────────────────────────────────────────────────────────────────
// Proper spreadsheets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indian digit grouping, so a CA reads lakhs the way he writes them.
 *
 * `482000` formats as `₹4,82,000`, not `₹482,000`. Applied as a NUMBER FORMAT,
 * never by writing a pre-formatted string: a cell holding "₹4,82,000" as text
 * cannot be summed, sorted or charted, which is the whole point of sending a
 * spreadsheet rather than a PDF.
 *
 * This is why `lib/format.ts`'s `formatCurrency` is not reused here — it emits
 * a string for a screen, and a string is exactly what these cells must not be.
 */
const INR_FORMAT = '[>=10000000]"₹"#,##,##,##0;[>=100000]"₹"#,##,##0;"₹"#,##0';
const DATE_FORMAT = "dd-mmm-yyyy";

/** Rupees as text, for the Report sheet's prose only — never for a data cell. */
const money = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * A real date cell, at local NOON.
 *
 * ExcelJS serialises a Date through the host's local offset. Midnight lands on
 * the previous or next day depending on which side of UTC the server sits, so
 * an export generated on a UTC host would show every expense a day early.
 * Noon is more than twelve hours from either boundary and cannot slip.
 */
function excelDate(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

type Col = { header: string; width: number; kind?: "date" | "money" };
type Cell = string | number | boolean | Date | null;

/**
 * A table a person can actually work with: frozen header, filter arrows, real
 * dates and real numbers.
 *
 * Written once, here, so no renderer can ship a sheet that looks like a dump.
 */
function writeTable(
  sheet: ExcelJS.Worksheet,
  cols: Col[],
  rows: Cell[][],
): { headerRow: number; firstDataRow: number; lastDataRow: number } {
  const header = sheet.addRow(cols.map((c) => c.header));
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1EDE7" } };
  cols.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width;
  });

  const firstDataRow = header.number + 1;
  for (const cells of rows) {
    const row = sheet.addRow(
      cells.map((v, i) => (cols[i]?.kind === "date" && typeof v === "string" ? excelDate(v) : v)),
    );
    cols.forEach((c, i) => {
      if (c.kind === "money") row.getCell(i + 1).numFmt = INR_FORMAT;
      if (c.kind === "date") row.getCell(i + 1).numFmt = DATE_FORMAT;
    });
  }
  const lastDataRow = firstDataRow + rows.length - 1;

  // The header stays put through a thousand rows, and every column can be
  // sorted and filtered without the owner writing anything.
  sheet.views = [{ state: "frozen", ySplit: header.number }];
  sheet.autoFilter = {
    from: { row: header.number, column: 1 },
    to: { row: Math.max(lastDataRow, header.number), column: cols.length },
  };

  return { headerRow: header.number, firstDataRow, lastDataRow };
}

/**
 * The total, as a live `SUM()` rather than a number Stayo asserts.
 *
 * A CA who filters the sheet can see the arithmetic; a hardcoded figure would
 * silently keep claiming the unfiltered total.
 */
function writeTotal(
  sheet: ExcelJS.Worksheet,
  cols: Col[],
  moneyCol: number,
  bounds: { firstDataRow: number; lastDataRow: number },
): void {
  const cells: Cell[] = new Array(cols.length).fill(null);
  const labelCol = Math.max(0, moneyCol - 1);
  cells[labelCol] = "Total";
  const empty = bounds.lastDataRow < bounds.firstDataRow;
  const letter = sheet.getColumn(moneyCol + 1).letter;
  const row = sheet.addRow(cells);
  row.getCell(moneyCol + 1).value = empty
    ? 0
    : ({ formula: `SUM(${letter}${bounds.firstDataRow}:${letter}${bounds.lastDataRow})` } as any);
  row.font = { bold: true };
  row.getCell(moneyCol + 1).numFmt = INR_FORMAT;
}

// ─────────────────────────────────────────────────────────────────────────────
// What is in this file, said before anybody has to trust it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The line every document carries so nobody has to trust it wasn't truncated.
 *
 * `Covers` is the honest companion to a period label: a file headed "All time"
 * whose earliest row is 2024 states both, rather than leaving the reader to
 * wonder which is wrong.
 */
export function provenance(d: {
  title: string;
  period: Period;
  scopeLabel: string;
  filterLabels: string[];
  count: number;
  total: number;
  generatedAt: Date;
  coverage?: { first: string; last: string } | null;
  truncatedFrom?: number | null;
}): string[][] {
  const rows: string[][] = [
    ["Export", d.title],
    ["Period", d.period.label],
  ];

  // Worth saying whenever the period does not pin the range down by itself.
  if (d.coverage && (isAllTime(d.period) || d.coverage.first !== d.period.from || d.coverage.last !== d.period.to)) {
    rows.push(["Covers", `${prettyDate(d.coverage.first)} – ${prettyDate(d.coverage.last)}`]);
  }

  rows.push(["Hostels", d.scopeLabel]);

  if (d.filterLabels.length) {
    d.filterLabels.forEach((label, i) => rows.push([i === 0 ? "Filters" : "", label]));
  } else {
    rows.push(["Filters", "None — everything in the period"]);
  }

  if (d.truncatedFrom) {
    // Truncation announces itself. A capped file that looked complete is the
    // one failure an owner cannot detect by reading it.
    rows.push(["Rows shown", `${d.count.toLocaleString("en-IN")} of ${d.truncatedFrom.toLocaleString("en-IN")}`]);
  } else {
    rows.push(["Rows", d.count.toLocaleString("en-IN")]);
  }

  rows.push(["Total", money(d.total)]);
  // formatIST, not toLocaleString: Node resolves Intl to the PROCESS timezone
  // when none is given, so a UTC host would label a UTC time as Indian.
  rows.push(["Generated", formatIST(d.generatedAt, { dateStyle: "medium", timeStyle: "short" })]);
  rows.push(["Source", "Figures as recorded in Stayo"]);
  return rows;
}

function writeReportSheet(wb: ExcelJS.Workbook, title: string, rows: string[][]): void {
  const sheet = wb.addWorksheet("Report");
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([]);
  for (const [k, v] of rows) {
    const row = sheet.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 52;
}

function coverageOf(dates: string[]): { first: string; last: string } | null {
  const clean = dates.filter(Boolean).sort();
  return clean.length ? { first: clean[0], last: clean[clean.length - 1] } : null;
}

function newWorkbook(generatedAt: Date): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stayo";
  wb.created = generatedAt;
  return wb;
}

export function exportFilename(req: { document: ExportDocumentId; period: Period }): string {
  return `${EXPORT_DOCUMENTS[req.document].stem}-${periodSlug(req.period)}.xlsx`;
}

/**
 * The filters that narrowed this file, in words.
 *
 * Shown on the Report sheet and on the export sheet's scope line, so the owner
 * and whoever he sends it to both know the file is a subset and of what.
 */
export function describeExpenseFilters(p: {
  search?: string;
  status?: string;
  vendor?: string;
  paymentMethod?: string;
  amountMin?: number;
  amountMax?: number;
  recurring?: boolean;
}): string[] {
  const out: string[] = [];
  if (p.search) out.push(`Search: ${p.search}`);
  if (p.status) out.push(`Status: ${p.status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}`);
  if (p.vendor) out.push(`Vendor: ${p.vendor}`);
  if (p.paymentMethod) out.push(`Paid by: ${p.paymentMethod}`);
  if (p.amountMin !== undefined && p.amountMax !== undefined) out.push(`Between ${money(p.amountMin)} and ${money(p.amountMax)}`);
  else if (p.amountMin !== undefined) out.push(`${money(p.amountMin)} and above`);
  else if (p.amountMax !== undefined) out.push(`${money(p.amountMax)} and below`);
  if (p.recurring === true) out.push("Recurring only");
  if (p.recurring === false) out.push("One-time only");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The sheets themselves
// ─────────────────────────────────────────────────────────────────────────────

const EXPENSE_COLS: Col[] = [
  { header: "Date", width: 13, kind: "date" },
  { header: "Title", width: 30 },
  { header: "Category", width: 20 },
  { header: "Amount (INR)", width: 15, kind: "money" },
  { header: "Vendor", width: 22 },
  { header: "Method", width: 14 },
  { header: "Status", width: 13 },
  { header: "Recurring", width: 11 },
  { header: "Hostel", width: 22 },
  { header: "Notes", width: 34 },
];

function expenseCells(e: ExpenseRow): Cell[] {
  return [
    e.date, e.title, e.category, e.amount, e.vendor, e.method,
    e.status, e.recurring ? "Yes" : "—", e.hostelName, e.notes,
  ];
}

const RENT_COLS: Col[] = [
  { header: "Date", width: 13, kind: "date" },
  { header: "Tenant", width: 26 },
  { header: "Hostel", width: 22 },
  { header: "Amount (INR)", width: 15, kind: "money" },
  { header: "Method", width: 14 },
  { header: "Reference", width: 26 },
  /**
   * ADR-094's rule, carried by a column instead of two sections.
   *
   * The proof-of-income PDF kept verified and self-reported money in separate
   * blocks so a lender could not read one as the other. That document is gone;
   * this column marks every rent row's provenance instead, which no reader can
   * skip past. It is weaker in one way — a spreadsheet reader can sum the two
   * together — and the ADR says so plainly rather than claiming equivalence.
   */
  { header: "How it reached you", width: 24 },
];

function rentCells(r: RentReceivedRow): Cell[] {
  return [
    r.date, r.tenantName, r.hostelName, r.amount, r.method, r.reference,
    r.source === "verified" ? "Through Stayo (verified)" : "Paid to you directly",
  ];
}

/** Expenses — the rows that were on his screen, and nothing else. */
export async function renderExpensesWorkbook(data: DocumentData): Promise<Uint8Array> {
  const { expenses, period, scopeLabel, filterLabels, generatedAt } = data;
  const wb = newWorkbook(generatedAt);
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  writeReportSheet(wb, "Expenses", provenance({
    title: "Expenses", period, scopeLabel, filterLabels,
    count: expenses.length, total, generatedAt,
    coverage: coverageOf(expenses.map((e) => e.date)),
    truncatedFrom: data.truncatedFrom,
  }));

  const sheet = wb.addWorksheet("Expenses");
  const bounds = writeTable(sheet, EXPENSE_COLS, expenses.map(expenseCells));
  writeTotal(sheet, EXPENSE_COLS, 3, bounds);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Collections — what came in, and who still owes. */
export async function renderCollectionsWorkbook(data: DocumentData): Promise<Uint8Array> {
  const { rent, owed, period, scopeLabel, filterLabels, generatedAt } = data;
  const wb = newWorkbook(generatedAt);
  const total = rent.reduce((s, r) => s + r.amount, 0);

  writeReportSheet(wb, "Rent collections", provenance({
    title: "Collections", period, scopeLabel, filterLabels,
    count: rent.length, total, generatedAt,
    coverage: coverageOf(rent.map((r) => r.date)),
  }));

  const received = wb.addWorksheet("Received");
  const receivedBounds = writeTable(received, RENT_COLS, rent.map(rentCells));
  writeTotal(received, RENT_COLS, 3, receivedBounds);

  const stillOwed = wb.addWorksheet("Still owed");
  // The chase list is about NOW, not the export period — an owner chasing rent
  // wants who owes today, and dating it to a past range would mislead him. The
  // sheet says so in its first row rather than relying on him knowing.
  stillOwed.addRow([
    `As at ${formatIST(generatedAt, { dateStyle: "medium", timeStyle: "short" })} — this sheet is about now, not the period above.`,
  ]).font = { italic: true, color: { argb: "FF6B6259" } };

  const owedCols: Col[] = [
    { header: "Tenant", width: 26 },
    { header: "Room", width: 10 },
    { header: "Hostel", width: 22 },
    { header: "Outstanding (INR)", width: 18, kind: "money" },
    { header: "Days overdue", width: 14 },
    { header: "Priority", width: 20 },
    { header: "Phone", width: 16 },
    { header: "Last payment", width: 14, kind: "date" },
  ];
  const owedBounds = writeTable(
    stillOwed,
    owedCols,
    owed.rows.map((r) => [
      r.tenantName, r.room || "—", r.hostelName, r.outstanding,
      r.daysOverdue > 0 ? r.daysOverdue : "—", r.priority, r.phone || "—", r.lastPaymentAt || null,
    ]),
  );
  writeTotal(stillOwed, owedCols, 3, owedBounds);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/**
 * Finance summary — rent received, expenses, and what is left, month by month.
 *
 * Four sheets rather than one, because a CA works sheet-by-sheet and pivots
 * from a clean table; a single blended dump has to be taken apart before it can
 * be used. `Month by month` is what he reads first — it is where an odd month
 * shows up.
 */
export async function renderFinanceWorkbook(data: DocumentData): Promise<Uint8Array> {
  const { rent, expenses, period, scopeLabel, generatedAt } = data;
  const wb = newWorkbook(generatedAt);

  const totalRent = rent.reduce((s, r) => s + r.amount, 0);
  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);

  writeReportSheet(wb, "Finance summary", provenance({
    title: "Finance summary", period, scopeLabel, filterLabels: data.filterLabels,
    count: rent.length + expenses.length, total: totalRent - totalExp, generatedAt,
    coverage: coverageOf([...rent.map((r) => r.date), ...expenses.map((e) => e.date)]),
  }));

  const rentSheet = wb.addWorksheet("Rent received");
  writeTotal(rentSheet, RENT_COLS, 3, writeTable(rentSheet, RENT_COLS, rent.map(rentCells)));

  const expSheet = wb.addWorksheet("Expenses");
  writeTotal(expSheet, EXPENSE_COLS, 3, writeTable(expSheet, EXPENSE_COLS, expenses.map(expenseCells)));

  const months = new Map<string, { rent: number; expenses: number }>();
  const bump = (key: string, field: "rent" | "expenses", amount: number) => {
    const row = months.get(key) ?? { rent: 0, expenses: 0 };
    row[field] += amount;
    months.set(key, row);
  };
  for (const r of rent) bump(r.date.slice(0, 7), "rent", r.amount);
  for (const e of expenses) bump(e.date.slice(0, 7), "expenses", e.amount);

  const sumCols: Col[] = [
    { header: "Month", width: 12 },
    { header: "Rent received (INR)", width: 20, kind: "money" },
    { header: "Expenses (INR)", width: 18, kind: "money" },
    // The screen says "what's left"; this sheet is read by an accountant, who
    // reads "Net". Neither says "profit" — nothing here is profit.
    { header: "Net (INR)", width: 16, kind: "money" },
  ];
  const sumSheet = wb.addWorksheet("Month by month");
  const sumBounds = writeTable(
    sumSheet,
    sumCols,
    Array.from(months.keys()).sort().map((key) => {
      const row = months.get(key)!;
      return [key, row.rent, row.expenses, row.rent - row.expenses];
    }),
  );
  const totalRow = sumSheet.addRow(["Total", totalRent, totalExp, totalRent - totalExp]);
  totalRow.font = { bold: true };
  [2, 3, 4].forEach((c) => (totalRow.getCell(c).numFmt = INR_FORMAT));
  void sumBounds;

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export const RENDERERS: Record<ExportDocumentId, (data: DocumentData) => Promise<Uint8Array>> = {
  expenses: renderExpensesWorkbook,
  collections: renderCollectionsWorkbook,
  finance: renderFinanceWorkbook,
};
