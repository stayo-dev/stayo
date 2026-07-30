import { Readable, PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "../db";
import { formatIST } from "../timezone";
import {
  buildExpenseLedgerWhere,
  resolveExpenseSort,
  getBusinessRevenue,
  computeNetProfit,
  computeProfitMargin,
  computeExpenseRatio,
  withCategoryPercentages,
  type ExpenseFilters,
} from "./expense-service";

export const EXPORT_REPORT_VERSION = "v1";

// Decoupled from HTTP: takes plain data, returns plain data/streams. The route handler
// (app/api/expenses/export/route.ts) is the only place that knows about Request/Response.
// This separation is what lets a future scheduled-export cron or a saved-report-template
// runner call the same generators without any redesign.

export type ExpenseExportFormat = "csv" | "xlsx" | "pdf";
export type ExpenseExportScope = "current_view" | "all_matching" | "selected";

export type ExpenseExportRequest = {
  ownerId: string;
  filters: ExpenseFilters;
  scope: ExpenseExportScope;
  ids?: string[];
  limit?: number;
  offset?: number;
  // Display-only — not used for querying (vendor/payment-method filtering already happens
  // via the merged `filters.search` substring match). Carried separately so the filter
  // snapshot in the report can name them individually instead of an opaque search string.
  filterSnapshot?: { vendor?: string; paymentMethod?: string };
  // Resolved by the route (which has the session) so this service stays auth-agnostic —
  // falls back to "Owner" if not supplied (e.g. a future non-HTTP caller).
  generatedByName?: string;
};

const BATCH_SIZE = 500;
const PDF_MAX_ROWS = 500;

const EXPORT_FIELDS = [
  "id",
  "title",
  "amount",
  "date",
  "category",
  "status",
  "vendor_name",
  "payment_method",
  "is_recurring",
  "recurring_frequency",
  "operational_type",
  "notes",
  "receipt_url",
] as const;

const COLUMNS: { header: string; key: (typeof EXPORT_FIELDS)[number] | "hostel"; width: number }[] = [
  { header: "Date", key: "date", width: 12 },
  { header: "Title", key: "title", width: 32 },
  { header: "Category", key: "category", width: 20 },
  { header: "Amount (INR)", key: "amount", width: 14 },
  { header: "Status", key: "status", width: 12 },
  { header: "Hostel", key: "hostel", width: 20 },
  { header: "Vendor", key: "vendor_name", width: 24 },
  { header: "Payment Method", key: "payment_method", width: 16 },
  { header: "Recurring", key: "is_recurring", width: 12 },
  { header: "Recurring Frequency", key: "recurring_frequency", width: 16 },
  { header: "Expense Type", key: "operational_type", width: 16 },
  { header: "Has Receipt", key: "receipt_url", width: 12 },
  { header: "Notes", key: "notes", width: 36 },
];

function whereForRequest(req: ExpenseExportRequest): { where: any; range: { start: Date; end: Date } | null } {
  if (req.scope === "selected") {
    if (!req.ids?.length) throw new Error("VALIDATION: No expenses selected for export");
    return { where: { id: { in: req.ids }, owner_id: req.ownerId } as any, range: null };
  }
  return buildExpenseLedgerWhere(req.ownerId, req.filters);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The date span the report's Financial Summary (revenue lookup, average daily spend) and
 * Reporting Period metadata are computed over. When the export has an explicit filter range
 * (current_view/all_matching scopes), that's authoritative. For scope=selected — arbitrary
 * hand-picked rows with no shared date filter — falls back to the min–max date actually
 * present in the exported set, so the metrics stay well-defined without special-casing.
 */
async function resolveReportDateSpan(req: ExpenseExportRequest, where: any, range: { start: Date; end: Date } | null) {
  if (range) return { start: range.start, end: range.end, isFallback: false };
  const bounds = await prisma.expenses.aggregate({ where, _min: { date: true }, _max: { date: true } });
  const start = bounds._min.date ?? new Date();
  // _max.date is inclusive (it's a real row's date); the rest of this module treats `end` as
  // exclusive, so bump by one day to match the `range.end` convention from buildExpenseLedgerWhere.
  const end = new Date((bounds._max.date ?? start).getTime() + MS_PER_DAY);
  return { start, end, isFallback: true };
}

// Batches through matching rows without ever holding more than one batch (BATCH_SIZE rows)
// in memory — the same mechanism regardless of whether the export is 50 rows or 500,000.
async function* iterateExpenseBatches(req: ExpenseExportRequest) {
  const { where } = whereForRequest(req);
  const orderBy = resolveExpenseSort(req.filters?.sort);
  const include = { hostels: { select: { name: true } } };

  if (req.scope === "current_view") {
    const take = Math.min(Math.max(1, req.limit ?? 100), 1000);
    const skip = Math.max(0, req.offset ?? 0);
    const rows = await prisma.expenses.findMany({ where, orderBy, take, skip, include });
    if (rows.length) yield rows;
    return;
  }

  let skip = 0;
  for (;;) {
    const rows: any[] = await prisma.expenses.findMany({ where, orderBy, take: BATCH_SIZE, skip, include });
    if (rows.length === 0) break;
    yield rows;
    if (rows.length < BATCH_SIZE) break;
    skip += BATCH_SIZE;
  }
}

function rowToRecord(row: any): Record<string, unknown> {
  return {
    date: row.date ? new Date(row.date).toISOString().slice(0, 10) : "",
    title: row.title || "",
    category: row.category || "",
    amount: Number(row.amount || 0),
    status: (row.status || "paid").toUpperCase(),
    hostel: row.hostels?.name || "Business (portfolio-level)",
    vendor_name: row.vendor_name || "",
    payment_method: row.payment_method || "",
    is_recurring: row.is_recurring ? "Yes" : "No",
    recurring_frequency: row.is_recurring ? row.recurring_frequency || "" : "",
    operational_type: row.operational_type || "",
    receipt_url: row.receipt_url ? "Yes" : "No",
    notes: row.notes || "",
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportFilename(format: ExpenseExportFormat) {
  const stamp = new Date().toISOString().slice(0, 10);
  const ext = format === "xlsx" ? "xlsx" : format;
  return `expenses-export-${stamp}.${ext}`;
}

export function exportContentType(format: ExpenseExportFormat) {
  if (format === "csv") return "text/csv; charset=utf-8";
  if (format === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/pdf";
}

/** Streams CSV rows as they're fetched — memory stays bounded to one batch at a time. */
export function streamExpensesCsv(req: ExpenseExportRequest): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        const header = COLUMNS.map((c) => csvCell(c.header)).join(",") + "\r\n";
        controller.enqueue(encoder.encode(header));
        for await (const batch of iterateExpenseBatches(req)) {
          const lines = batch
            .map((row: any) => {
              const record = rowToRecord(row);
              return COLUMNS.map((c) => csvCell(record[c.key])).join(",");
            })
            .join("\r\n");
          controller.enqueue(encoder.encode(lines + "\r\n"));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Streams a true streaming XLSX write (ExcelJS WorkbookWriter flushes rows to the
 * underlying Node stream incrementally) — does not buffer the whole workbook in memory
 * regardless of row count, unlike building an in-memory `xlsx` (SheetJS) workbook.
 *
 * Single sheet, blank-row-separated sections (Metadata → Financial Summary → Category
 * Breakdown → Expense Table) rather than one undifferentiated dump — the data table's own
 * header row only appears once the reader has scrolled past the report context, and column
 * widths/keys are set manually (not via `sheet.columns`) so that assignment doesn't
 * auto-write its own header row at row 1 ahead of the metadata block.
 */
export async function streamExpensesXlsx(req: ExpenseExportRequest): Promise<ReadableStream<Uint8Array>> {
  const summary = await getExportSummary(req);
  const nodePassthrough = new PassThrough();

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: nodePassthrough,
    useStyles: true,
    useSharedStrings: false,
  });
  const sheet = workbook.addWorksheet("Expenses");
  COLUMNS.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width;
  });

  const addRow = (values: unknown[], opts: { bold?: boolean } = {}) => {
    const row = sheet.addRow(values);
    if (opts.bold) row.font = { bold: true };
    row.commit();
  };
  const blankRow = () => sheet.addRow([]).commit();

  const { metadata, financials, largestExpense } = summary;

  addRow([metadata.reportTitle], { bold: true });
  addRow([`Report Version: ${metadata.reportVersion}`]);
  addRow(["Generated by", metadata.generatedByName]);
  addRow(["Generated at", formatIST(metadata.generatedAt)]);
  addRow(["Hostel", metadata.hostelLabel]);
  addRow(["Reporting Period", `${metadata.reportingPeriod.start} → ${metadata.reportingPeriod.end}`]);
  addRow(["Duration", `${metadata.reportingPeriod.durationDays} day(s)`]);
  addRow(["Export Scope", metadata.exportScopeLabel]);
  addRow(["Sort Order", metadata.sortOrderLabel]);
  for (const f of metadata.filterSnapshot) addRow([f.label, f.value]);
  blankRow();

  addRow(["Financial Summary"], { bold: true });
  if (financials.revenueUnavailable) {
    addRow(["Revenue", "Unavailable"]);
    addRow(["Net Profit", "Unavailable"]);
    addRow(["Expense Ratio", "Unavailable"]);
  } else {
    addRow(["Revenue", financials.revenue]);
    addRow(["Net Profit", financials.netProfit]);
    addRow(["Expense Ratio", `${financials.expenseRatio}%`]);
  }
  addRow(["Expenses", summary.totalAmount]);
  addRow(["Average Daily Spend", financials.averageDailySpend]);
  addRow(["Transactions", summary.totalCount]);
  if (largestExpense) {
    addRow(["Largest Expense", `${largestExpense.title} (${largestExpense.category}, ${largestExpense.date})`, largestExpense.amount]);
  }
  if (summary.categoryBreakdown[0]) {
    addRow(["Largest Category", summary.categoryBreakdown[0].category, summary.categoryBreakdown[0].amount]);
  }
  if (summary.vendorBreakdown[0]) {
    addRow(["Largest Vendor", summary.vendorBreakdown[0].vendor, summary.vendorBreakdown[0].amount]);
  }
  blankRow();

  addRow(["Category Breakdown"], { bold: true });
  addRow(["Category", "Amount", "Percentage", "Count"], { bold: true });
  for (const c of summary.categoryBreakdown) addRow([c.category, c.amount, `${c.percentage}%`, c.count]);
  blankRow();

  addRow(
    COLUMNS.map((c) => c.header),
    { bold: true },
  );

  (async () => {
    try {
      for await (const batch of iterateExpenseBatches(req)) {
        for (const row of batch) {
          const record = rowToRecord(row);
          sheet.addRow(COLUMNS.map((c) => record[c.key])).commit();
        }
      }
      await sheet.commit();
      await workbook.commit();
    } catch (error) {
      nodePassthrough.destroy(error as Error);
    }
  })();

  return Readable.toWeb(nodePassthrough) as ReadableStream<Uint8Array>;
}

export type ExpenseExportFinancials = {
  revenue: number | null;
  netProfit: number | null;
  expenseRatio: number | null;
  revenueUnavailable: boolean;
  averageDailySpend: number;
};

export type ExpenseExportLargestExpense = {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: string;
} | null;

export type ExpenseExportMetadata = {
  reportTitle: string;
  reportVersion: string;
  generatedByName: string;
  generatedAt: string;
  hostelLabel: string;
  reportingPeriod: { start: string; end: string; durationDays: number };
  exportScopeLabel: string;
  sortOrderLabel: string;
  filterSnapshot: { label: string; value: string }[];
};

export type ExpenseExportSummary = {
  totalCount: number;
  totalAmount: number;
  categoryBreakdown: { category: string; amount: number; count: number; percentage: number }[];
  vendorBreakdown: { vendor: string; amount: number; count: number }[];
  statusBreakdown: { status: string; amount: number; count: number }[];
  financials: ExpenseExportFinancials;
  largestExpense: ExpenseExportLargestExpense;
  metadata: ExpenseExportMetadata;
};

const SCOPE_LABELS: Record<ExpenseExportScope, string> = {
  current_view: "Current View",
  all_matching: "All Matching Records",
  selected: "Selected Expenses",
};

const SORT_LABELS: Record<string, string> = {
  recent: "Newest First",
  highest: "Highest Amount First",
  oldest: "Oldest First",
  category: "By Category",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function reportDateLabel(filters: ExpenseFilters, start: Date, end: Date): string {
  // Relative quick-filter presets get the exact label the UI's own date buttons use
  // (see ExpenseFilterBar.tsx) — reserving "<Month> <Year>" for an explicit custom range
  // that happens to land within a single calendar month, which is a genuinely different
  // (deliberately-picked) scenario from "whatever the current month is."
  if (!filters.startDate && !filters.endDate) {
    if (filters.range === "today") return "Today";
    if (filters.range === "week") return "This Week";
    if (!filters.range || filters.range === "month") return "This Month";
  }
  const inclusiveEnd = new Date(end.getTime() - MS_PER_DAY);
  // UTC getters, not local: `start`/`end` are @db.Date columns (UTC-midnight-encoded),
  // and using server-local getters here would misread the month on a non-UTC host.
  const sameMonth = start.getUTCFullYear() === inclusiveEnd.getUTCFullYear() && start.getUTCMonth() === inclusiveEnd.getUTCMonth();
  if (sameMonth) return formatIST(start, { month: "long", year: "numeric" });
  return "Custom Range";
}

function buildReportTitle(req: ExpenseExportRequest, dateLabel: string): string {
  if (req.scope === "selected") return "Business Expense Report — Selected Expenses";
  if (req.filters.categories?.length === 1) return `Business Expense Report — ${req.filters.categories[0]}`;
  return `Business Expense Report — ${dateLabel}`;
}

/** Every applied filter as its own labeled line — reproducibility, not prose (see describeFilters for that). */
function buildFilterSnapshot(req: ExpenseExportRequest): { label: string; value: string }[] {
  const { filters, filterSnapshot } = req;
  const lines: { label: string; value: string }[] = [];
  if (filters.categories?.length) lines.push({ label: "Category", value: filters.categories.join(", ") });
  if (filters.status && filters.status !== "all") lines.push({ label: "Status", value: filters.status });
  if (filterSnapshot?.paymentMethod) lines.push({ label: "Payment Method", value: filterSnapshot.paymentMethod });
  if (filterSnapshot?.vendor) lines.push({ label: "Vendor", value: filterSnapshot.vendor });
  if (typeof filters.recurring === "boolean") lines.push({ label: "Recurring", value: filters.recurring ? "Yes" : "No" });
  if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
    lines.push({ label: "Amount Range", value: `${filters.amountMin ?? 0} – ${filters.amountMax ?? "∞"}` });
  }
  if (lines.length === 0) lines.push({ label: "Filters", value: "None applied — all expenses" });
  lines.push({ label: "Sort", value: SORT_LABELS[filters.sort || "recent"] || "Newest First" });
  return lines;
}

/**
 * Aggregates over the exact same filtered set being exported, plus the report-level
 * financials (revenue/net profit/ratio — via the shared expense-service.ts calculations,
 * scoped to this export's own date span, never recomputed independently) and metadata.
 * A revenue-lookup failure is isolated: it degrades that one section, not the whole report.
 */
export async function getExportSummary(req: ExpenseExportRequest): Promise<ExpenseExportSummary> {
  const { where, range } = whereForRequest(req);

  const [totals, byCategory, byVendor, byStatus, largest, hostel] = await Promise.all([
    prisma.expenses.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expenses.groupBy({ by: ["category"], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expenses.groupBy({
      by: ["vendor_name"],
      where: { ...where, vendor_name: { not: null } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expenses.groupBy({ by: ["status"], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expenses.findFirst({ where, orderBy: { amount: "desc" } }),
    req.filters.hostelId
      ? prisma.hostels.findUnique({ where: { id: req.filters.hostelId }, select: { name: true } })
      : Promise.resolve(null as { name: string } | null),
  ]);

  const totalAmount = Number(totals._sum.amount || 0);
  const dateSpan = await resolveReportDateSpan(req, where, range);

  let revenue: number | null = null;
  let revenueUnavailable = false;
  try {
    revenue = await getBusinessRevenue(req.ownerId, dateSpan.start, dateSpan.end, req.filters.hostelId);
  } catch (error) {
    console.error("[expense-export] revenue lookup failed — continuing without it", error);
    revenueUnavailable = true;
  }

  const netProfit = revenue !== null ? computeNetProfit(revenue, totalAmount) : null;
  const expenseRatio = revenue !== null ? computeExpenseRatio(totalAmount, revenue) : null;
  const spanDays = Math.max(1, Math.round((dateSpan.end.getTime() - dateSpan.start.getTime()) / MS_PER_DAY));
  const averageDailySpend = round2(totalAmount / spanDays);

  const categoryBreakdown = withCategoryPercentages(
    (byCategory as any[])
      .map((r) => ({ category: r.category, amount: Number(r._sum.amount || 0), count: r._count._all }))
      .sort((a, b) => b.amount - a.amount),
    totalAmount,
  );
  const vendorBreakdown = (byVendor as any[])
    .filter((r) => r.vendor_name)
    .map((r) => ({ vendor: r.vendor_name, amount: Number(r._sum.amount || 0), count: r._count._all }))
    .sort((a, b) => b.amount - a.amount);
  const statusBreakdown = (byStatus as any[])
    .map((r) => ({ status: (r.status || "paid").toUpperCase(), amount: Number(r._sum.amount || 0), count: r._count._all }))
    .sort((a, b) => b.amount - a.amount);

  const largestExpense: ExpenseExportLargestExpense = largest
    ? {
        id: (largest as any).id,
        title: (largest as any).title || "(untitled)",
        amount: Number((largest as any).amount || 0),
        category: (largest as any).category || "Miscellaneous",
        date: (largest as any).date ? new Date((largest as any).date).toISOString().slice(0, 10) : "",
      }
    : null;

  const dateLabel = reportDateLabel(req.filters, dateSpan.start, dateSpan.end);
  const inclusiveEnd = new Date(dateSpan.end.getTime() - MS_PER_DAY);

  const metadata: ExpenseExportMetadata = {
    reportTitle: buildReportTitle(req, dateLabel),
    reportVersion: EXPORT_REPORT_VERSION,
    generatedByName: req.generatedByName || "Owner",
    generatedAt: new Date().toISOString(),
    hostelLabel: hostel?.name || "All Hostels (Portfolio)",
    reportingPeriod: {
      start: dateSpan.start.toISOString().slice(0, 10),
      end: inclusiveEnd.toISOString().slice(0, 10),
      durationDays: spanDays,
    },
    exportScopeLabel: SCOPE_LABELS[req.scope],
    sortOrderLabel: SORT_LABELS[req.filters.sort || "recent"] || "Newest First",
    filterSnapshot: buildFilterSnapshot(req),
  };

  return {
    totalCount: totals._count._all,
    totalAmount,
    categoryBreakdown,
    vendorBreakdown,
    statusBreakdown,
    financials: { revenue, netProfit, expenseRatio, revenueUnavailable, averageDailySpend },
    largestExpense,
    metadata,
  };
}

export function describeFilters(filters: ExpenseFilters): string[] {
  const lines: string[] = [];
  if (filters.range === "custom" && (filters.startDate || filters.endDate)) {
    lines.push(`Date range: ${filters.startDate || "…"} to ${filters.endDate || "…"}`);
  } else if (filters.range) {
    lines.push(`Date range: ${({ today: "Today", week: "This Week", month: "This Month" } as any)[filters.range] || filters.range}`);
  }
  if (filters.status && filters.status !== "all") lines.push(`Status: ${filters.status}`);
  if (filters.categories?.length) lines.push(`Categories: ${filters.categories.join(", ")}`);
  if (filters.search) lines.push(`Search: "${filters.search}"`);
  if (typeof filters.recurring === "boolean") lines.push(`Recurring: ${filters.recurring ? "Yes only" : "One-time only"}`);
  if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
    lines.push(`Amount: ${filters.amountMin ?? "0"} – ${filters.amountMax ?? "∞"}`);
  }
  return lines.length ? lines : ["No filters applied — all expenses"];
}

const INR = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;

/**
 * Builds a business-report PDF (summary metrics, category/vendor breakdown, applied
 * filters, capped expense list) — a report artifact, not an unbounded data dump, so it
 * is buffer-based (pdf-lib) rather than streamed like CSV/XLSX. Row count is capped at
 * PDF_MAX_ROWS with an explicit truncation note if the matching set is larger.
 */
export async function generateExpensesPdf(req: ExpenseExportRequest): Promise<Uint8Array> {
  const summary = await getExportSummary(req);
  const filterLines = req.scope === "selected" ? [`${req.ids?.length || 0} selected expense(s)`] : describeFilters(req.filters);

  // For current_view scope this naturally respects req.limit/req.offset (the on-screen
  // page); for all_matching/selected it batches in pages of BATCH_SIZE and we stop as
  // soon as we have enough rows for the report.
  const rows: any[] = [];
  for await (const batch of iterateExpenseBatches(req)) {
    rows.push(...batch);
    if (rows.length >= PDF_MAX_ROWS) break;
  }
  const truncated = rows.length > PDF_MAX_ROWS ? rows.slice(0, PDF_MAX_ROWS) : rows;
  const isTruncated = summary.totalCount > truncated.length;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageSize: [number, number] = [595.28, 841.89]; // A4
  const margin = 40;
  let page = doc.addPage(pageSize);
  let y = pageSize[1] - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage(pageSize);
      y = pageSize[1] - margin;
    }
  };

  const text = (str: string, opts: { size?: number; f?: PDFFont; color?: [number, number, number]; x?: number } = {}) => {
    const size = opts.size ?? 10;
    ensureSpace(size + 4);
    page.drawText(str, {
      x: opts.x ?? margin,
      y,
      size,
      font: opts.f ?? font,
      color: rgb(...(opts.color ?? [0.1, 0.1, 0.1])),
    });
    y -= size + 6;
  };

  const { metadata, financials, largestExpense } = summary;

  text(metadata.reportTitle, { size: 20, f: bold });
  text(`Report Version: ${metadata.reportVersion}`, { size: 8.5, color: [0.55, 0.55, 0.55] });
  y -= 8;

  text("Report Metadata", { size: 13, f: bold });
  text(`Generated by: ${metadata.generatedByName}`, { size: 9.5 });
  text(`Generated at: ${formatIST(metadata.generatedAt)}`, { size: 9.5 });
  text(`Hostel: ${metadata.hostelLabel}`, { size: 9.5 });
  text(
    // pdf-lib's standard Helvetica font (WinAnsi encoding) can't render "→" — plain ASCII only here.
    `Reporting Period: ${metadata.reportingPeriod.start} to ${metadata.reportingPeriod.end}  (${metadata.reportingPeriod.durationDays} day${metadata.reportingPeriod.durationDays === 1 ? "" : "s"})`,
    { size: 9.5 },
  );
  text(`Export Scope: ${metadata.exportScopeLabel}`, { size: 9.5 });
  text(`Sort Order: ${metadata.sortOrderLabel}`, { size: 9.5 });
  y -= 8;

  text("Filter Snapshot", { size: 13, f: bold });
  for (const f of metadata.filterSnapshot) text(`${f.label}: ${f.value}`, { size: 9.5 });
  y -= 8;

  text("Applied Filters", { size: 13, f: bold });
  for (const line of filterLines) text(`• ${line}`, { size: 9.5 });
  y -= 8;

  text("Financial Summary", { size: 13, f: bold });
  if (financials.revenueUnavailable) {
    text("Revenue: unavailable", { size: 10, color: [0.6, 0.2, 0.1] });
    text("Net Profit: unavailable", { size: 10, color: [0.6, 0.2, 0.1] });
    text("Expense Ratio: unavailable", { size: 10, color: [0.6, 0.2, 0.1] });
  } else {
    text(`Revenue: ${INR(financials.revenue || 0)}`, { size: 10 });
    text(`Expenses: ${INR(summary.totalAmount)}`, { size: 10 });
    text(`Net Profit: ${INR(financials.netProfit || 0)}`, { size: 10 });
    text(`Expense Ratio: ${financials.expenseRatio !== null ? financials.expenseRatio + "%" : "—"}`, { size: 10 });
  }
  text(`Average Daily Spend: ${INR(financials.averageDailySpend)}`, { size: 10 });
  text(`Transactions: ${summary.totalCount}`, { size: 10 });
  if (largestExpense) {
    text(
      `Largest Expense: ${largestExpense.title} — ${INR(largestExpense.amount)} — ${largestExpense.category} — ${largestExpense.date}`,
      { size: 10 },
    );
  }
  if (summary.categoryBreakdown[0]) {
    text(`Largest Category: ${summary.categoryBreakdown[0].category} (${INR(summary.categoryBreakdown[0].amount)})`, { size: 10 });
  }
  if (summary.vendorBreakdown[0]) {
    text(`Largest Vendor: ${summary.vendorBreakdown[0].vendor} (${INR(summary.vendorBreakdown[0].amount)})`, { size: 10 });
  }
  y -= 8;

  text("Payment Insights", { size: 13, f: bold });
  if (summary.statusBreakdown.length === 0) {
    text("No expenses match these filters.", { size: 9.5, color: [0.5, 0.5, 0.5] });
  }
  for (const s of summary.statusBreakdown) {
    text(`${s.status}: ${INR(s.amount)} (${s.count} entries)`, { size: 9.5 });
  }
  y -= 8;

  text("Category Breakdown", { size: 13, f: bold });
  for (const c of summary.categoryBreakdown.slice(0, 20)) {
    text(`${c.category}: ${INR(c.amount)} (${c.percentage}%, ${c.count} entries)`, { size: 9.5 });
  }
  y -= 8;

  text("Vendor Summary", { size: 13, f: bold });
  if (summary.vendorBreakdown.length === 0) {
    text("No vendor data recorded.", { size: 9.5, color: [0.5, 0.5, 0.5] });
  }
  for (const v of summary.vendorBreakdown.slice(0, 20)) {
    text(`${v.vendor}: ${INR(v.amount)} (${v.count} payments)`, { size: 9.5 });
  }
  y -= 12;

  text("Expense List", { size: 13, f: bold });
  if (isTruncated) {
    text(`Showing first ${truncated.length} of ${summary.totalCount} matching expenses — use CSV or Excel export for the full list.`, {
      size: 8.5,
      color: [0.6, 0.4, 0.1],
    });
  }

  const colX = [margin, margin + 65, margin + 260, margin + 350, margin + 420];
  const drawTableHeader = () => {
    ensureSpace(16);
    const headers = ["Date", "Title", "Category", "Status", "Amount"];
    headers.forEach((h, i) => page.drawText(h, { x: colX[i], y, size: 9, font: bold }));
    y -= 14;
    page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: pageSize[0] - margin, y: y + 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  };
  drawTableHeader();

  for (const row of truncated) {
    ensureSpace(14);
    if (y === pageSize[1] - margin - 14) drawTableHeader();
    const record = rowToRecord(row);
    const cells = [
      String(record.date),
      String(record.title).slice(0, 34),
      String(record.category).slice(0, 18),
      String(record.status),
      INR(Number(record.amount)),
    ];
    cells.forEach((cellText, i) => page.drawText(cellText, { x: colX[i], y, size: 8.5, font }));
    y -= 13;
  }

  // Footer pass — done last, over every page at once, since total page count isn't known
  // until all content above has been laid out (pages are added on demand via ensureSpace).
  const generatedOn = formatIST(metadata.generatedAt, { year: "numeric", month: "2-digit", day: "2-digit" });
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footerText = `Generated by HMS · Generated on ${generatedOn} · Page ${i + 1} of ${pages.length}`;
    p.drawText(footerText, { x: margin, y: 18, size: 7.5, font, color: rgb(0.55, 0.55, 0.55) });
  });

  return doc.save();
}
