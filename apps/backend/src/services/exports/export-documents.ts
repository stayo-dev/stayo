import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Period } from "./financial-year";

/**
 * The four documents an owner actually needs, rendered from already-fetched rows.
 *
 * Every export an owner makes gets handed to somebody else — an accountant, a
 * bank officer, a business partner, a manager. Only reconciliation is for
 * himself. So the unit here is a DOCUMENT with an audience, not a data dump
 * with a format flag: the owner picks who it is for, and this module decides
 * the shape, the columns and the file type.
 *
 * **No I/O.** Rendering is the risky half — pdf-lib throws outright on a glyph
 * its font cannot encode, and both "₹" and any Telugu or Devanagari tenant name
 * are exactly that — and it is the half with nothing to do with a database.
 * Kept free of imports that reach one, it runs under vitest.pure.config.ts and
 * the cases that actually break get real coverage instead of one smoke test.
 * Fetching lives in `owner-money-export-service.ts`.
 */

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

export type PayoutWithTenants = {
  id: string;
  amount: number;
  status: string;
  method: string | null;
  reference: string | null;
  paidAt: string | null;
  tenants: { name: string; hostelName: string; amount: number; date: string }[];
};

export type ExportDocumentId = "accountant" | "proof_of_income" | "reconciliation" | "who_owes_me";
export type ExportFormat = "xlsx" | "pdf";

export const EXPORT_DOCUMENTS: Record<
  ExportDocumentId,
  { label: string; sub: string; format: ExportFormat; stem: string }
> = {
  accountant: {
    label: "For my accountant",
    sub: "Rent received and expenses, month by month",
    format: "xlsx",
    stem: "rent-register",
  },
  proof_of_income: {
    label: "Proof of income",
    sub: "For a bank, landlord or partner",
    format: "pdf",
    stem: "income-statement",
  },
  reconciliation: {
    label: "Bank reconciliation",
    sub: "Payouts with references, and who paid each one",
    format: "xlsx",
    stem: "bank-reconciliation",
  },
  who_owes_me: {
    label: "Who owes me",
    sub: "Printable list to chase or hand over",
    format: "pdf",
    stem: "outstanding-rent",
  },
};

/**
 * Everything a document needs, already fetched.
 *
 * Rendering is deliberately separated from gathering. The risky half of this
 * module is the rendering — pdf-lib throws on a glyph its font cannot encode,
 * and "₹" and any Telugu or Devanagari tenant name are exactly that — and it is
 * the half that has nothing to do with a database. Split this way it is
 * testable without one, which is the difference between one live smoke test and
 * real coverage of the cases that actually break.
 */
export type DocumentData = {
  period: Period;
  scopeLabel: string;
  rent: RentReceivedRow[];
  expenses: { date: string; title: string; category: string; amount: number; vendor: string; method: string; status: string; hostelName: string }[];
  payouts: PayoutWithTenants[];
  queue: { totalTenants: number; totalOutstanding: number; groups: { label: string; count: number; totalOutstanding: number; rows: ChaseRow[] }[] };
};

export type ChaseRow = {
  tenantName: string; room: string; hostelName: string;
  outstanding: number; daysOverdue: number; phone: string;
};

export const EMPTY_DOCUMENT_DATA: Omit<DocumentData, "period" | "scopeLabel"> = {
  rent: [], expenses: [], payouts: [],
  queue: { totalTenants: 0, totalOutstanding: 0, groups: [] },
};

const money = (n: number) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * `Rs.` and not `₹`, in PDFs only.
 *
 * pdf-lib's standard fonts are WinAnsi-encoded and U+20B9 is not in WinAnsi —
 * drawing it throws rather than degrading, so a rupee sign would fail the
 * export outright. Spreadsheets are UTF-8 and keep the real symbol.
 */
const pdfMoney = (n: number) => `Rs. ${money(n)}`;

/**
 * Strip anything the PDF's font cannot encode.
 *
 * Tenant names are user data and are routinely entered in Telugu, Hindi or
 * Kannada. pdf-lib throws on the first unencodable glyph, so without this a
 * single non-Latin name would fail the whole chase list — and it would fail for
 * exactly the owners most likely to have such names on their roster. A
 * transliterated-away name is imperfect; a document that will not generate is
 * useless.
 */
function pdfSafe(value: unknown): string {
  const str = String(value ?? "");
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    out += code >= 32 && code <= 255 ? ch : "?";
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// What is in this file, said before it is generated
// ─────────────────────────────────────────────────────────────────────────────

/** The line every document carries so nobody has to trust it wasn't truncated. */
function provenance(period: Period, scopeLabel: string, count: number, total: number) {
  return [
    ["Period", period.label],
    ["Hostels", scopeLabel],
    ["Rows", String(count)],
    ["Total", money(total)],
    ["Generated", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })],
    ["Source", "Figures as recorded in Stayo"],
  ];
}

export function exportFilename(req: { document: ExportDocumentId; period: Period }): string {
  const doc = EXPORT_DOCUMENTS[req.document];
  return `${doc.stem}-${req.period.from}-to-${req.period.to}.${doc.format}`;
}

export function exportContentType(document: ExportDocumentId): string {
  return EXPORT_DOCUMENTS[document].format === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/pdf";
}

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheets
// ─────────────────────────────────────────────────────────────────────────────

function writeProvenanceSheet(sheet: ExcelJS.Worksheet, title: string, rows: string[][]) {
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([]);
  for (const [k, v] of rows) {
    const row = sheet.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  }
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 46;
}

function header(sheet: ExcelJS.Worksheet, headers: string[], widths: number[]) {
  const row = sheet.addRow(headers);
  row.font = { bold: true };
  headers.forEach((_, i) => (sheet.getColumn(i + 1).width = widths[i]));
}

/**
 * The accountant's workbook: rent received, expenses, and a month-by-month summary.
 *
 * Three sheets rather than one, because a CA works sheet-by-sheet and pivots
 * from a clean table — a single blended dump has to be taken apart before it
 * can be used.
 */
export async function renderAccountantWorkbook(data: DocumentData): Promise<Uint8Array> {
  const { rent, expenses, period, scopeLabel } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Stayo";

  const totalRent = rent.reduce((s, r) => s + r.amount, 0);
  writeProvenanceSheet(
    wb.addWorksheet("Report"),
    "Rent register",
    provenance(period, scopeLabel, rent.length, totalRent),
  );

  const rentSheet = wb.addWorksheet("Rent received");
  header(
    rentSheet,
    ["Date", "Tenant", "Hostel", "Amount (INR)", "Method", "Reference", "How it reached you"],
    [12, 26, 22, 14, 14, 26, 22],
  );
  for (const r of rent) {
    rentSheet.addRow([
      r.date, r.tenantName, r.hostelName, r.amount, r.method, r.reference,
      r.source === "verified" ? "Through Stayo (verified)" : "Paid to you directly",
    ]);
  }
  rentSheet.addRow([]);
  rentSheet.addRow(["", "", "Total", totalRent]).font = { bold: true };

  const expSheet = wb.addWorksheet("Expenses");
  header(expSheet, ["Date", "Title", "Category", "Amount (INR)", "Vendor", "Method", "Status", "Hostel"],
    [12, 30, 18, 14, 22, 14, 12, 22]);
  let totalExp = 0;
  for (const e of expenses) {
    totalExp += e.amount;
    expSheet.addRow([e.date, e.title, e.category, e.amount, e.vendor, e.method, e.status, e.hostelName]);
  }
  expSheet.addRow([]);
  expSheet.addRow(["", "", "Total", totalExp]).font = { bold: true };

  // Month by month is what a CA reads first — it is where an odd month shows up.
  const months = new Map<string, { rent: number; expenses: number }>();
  const bump = (key: string, field: "rent" | "expenses", amount: number) => {
    const row = months.get(key) ?? { rent: 0, expenses: 0 };
    row[field] += amount;
    months.set(key, row);
  };
  for (const r of rent) bump(r.date.slice(0, 7), "rent", r.amount);
  for (const e of expenses) bump(e.date.slice(0, 7), "expenses", e.amount);

  const sumSheet = wb.addWorksheet("Summary");
  header(sumSheet, ["Month", "Rent received (INR)", "Expenses (INR)", "Net (INR)"], [12, 20, 18, 16]);
  for (const key of Array.from(months.keys()).sort()) {
    const row = months.get(key)!;
    sumSheet.addRow([key, row.rent, row.expenses, row.rent - row.expenses]);
  }
  sumSheet.addRow([]);
  sumSheet.addRow(["Total", totalRent, totalExp, totalRent - totalExp]).font = { bold: true };

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Reconciliation: one row per bank credit, the tenants under it indented. */
export async function renderReconciliationWorkbook(data: DocumentData): Promise<Uint8Array> {
  const { payouts, period, scopeLabel } = data;
  const total = payouts.reduce((s, p) => s + p.amount, 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Stayo";
  writeProvenanceSheet(
    wb.addWorksheet("Report"),
    "Bank reconciliation",
    provenance(period, scopeLabel, payouts.length, total),
  );

  const sheet = wb.addWorksheet("Payouts");
  header(sheet, ["Paid on", "Amount (INR)", "Status", "Method", "Reference (UTR)", "Paid by tenant", "Tenant amount", "Collected on"],
    [12, 14, 14, 16, 26, 26, 14, 13]);

  for (const p of payouts) {
    const row = sheet.addRow([
      p.paidAt ?? "", p.amount, p.status, p.method ?? "", p.reference ?? "", "", "", "",
    ]);
    row.font = { bold: true };
    // Children explain the parent. An owner ticking his passbook reads the bold
    // line, then the names that make it up — never a flat list he has to group.
    for (const t of p.tenants) {
      sheet.addRow(["", "", "", "", "", `   ${t.name}${t.hostelName ? ` · ${t.hostelName}` : ""}`, t.amount, t.date]);
    }
  }
  sheet.addRow([]);
  sheet.addRow(["Total", total]).font = { bold: true };

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────────────────────────────────────
// PDFs
// ─────────────────────────────────────────────────────────────────────────────

type Pen = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
  newPage: () => void;
};

async function startPdf(): Promise<Pen> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pen: Pen = {
    doc, font, bold,
    page: doc.addPage([595, 842]), // A4
    y: 800,
    newPage: () => {
      pen.page = doc.addPage([595, 842]);
      pen.y = 800;
    },
  };
  return pen;
}

function line(pen: Pen, text: string, opts: { size?: number; bold?: boolean; gap?: number; color?: [number, number, number] } = {}) {
  const size = opts.size ?? 10;
  if (pen.y < 60) pen.newPage();
  pen.page.drawText(pdfSafe(text), {
    x: 48,
    y: pen.y,
    size,
    font: opts.bold ? pen.bold : pen.font,
    color: opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.1),
  });
  pen.y -= (opts.gap ?? size + 6);
}

function row(pen: Pen, cells: string[], xs: number[], opts: { bold?: boolean; size?: number } = {}) {
  const size = opts.size ?? 9;
  if (pen.y < 60) pen.newPage();
  cells.forEach((cell, i) => {
    pen.page.drawText(pdfSafe(cell), {
      x: xs[i], y: pen.y, size,
      font: opts.bold ? pen.bold : pen.font,
      color: rgb(0.1, 0.1, 0.1),
    });
  });
  pen.y -= size + 6;
}

/**
 * The two sections of a proof-of-income document, and the wall between them.
 *
 * A pure function on purpose: "verified and self-reported money are never
 * merged into one figure" is the rule that stops this document misleading a
 * lender, and a rule that only exists inside a PDF drawing call cannot be
 * tested. Both sections are always returned, even when empty — an absent
 * section would quietly turn a mixed statement into one that looks entirely
 * verified.
 */
export function proofOfIncomeSections(
  rows: RentReceivedRow[],
): { key: "verified" | "owner_recorded"; title: string; note: string; rows: RentReceivedRow[]; total: number }[] {
  const pick = (source: RentReceivedRow["source"]) => rows.filter((r) => r.source === source);
  const total = (list: RentReceivedRow[]) => list.reduce((sum, r) => sum + r.amount, 0);
  const verified = pick("verified");
  const recorded = pick("owner_recorded");
  return [
    {
      key: "verified",
      title: "Verified by Stayo",
      note: "Collected through Stayo's payment gateway. Each payment carries a payment-provider reference.",
      rows: verified,
      total: total(verified),
    },
    {
      key: "owner_recorded",
      title: "Recorded by the owner",
      note: "Cash and direct UPI, entered by the owner. Stayo did not handle this money and cannot independently confirm it.",
      rows: recorded,
      total: total(recorded),
    },
  ];
}

/**
 * Proof of income — the document that goes across a desk at a bank.
 *
 * Verified and owner-recorded money are shown as two SEPARATE sections with
 * their own totals, never as one blended figure with a footnote. A credit
 * officer skims footnotes; the structure has to carry the distinction. Blending
 * them would present self-reported cash as third-party-verified income, which
 * is the one way this feature could actively mislead someone.
 */
export async function renderProofOfIncomePdf(data: DocumentData): Promise<Uint8Array> {
  const { rent: rows, period, scopeLabel } = data;
  const verified = rows.filter((r) => r.source === "verified");
  const recorded = rows.filter((r) => r.source === "owner_recorded");
  const sum = (list: RentReceivedRow[]) => list.reduce((s, r) => s + r.amount, 0);

  const pen = await startPdf();
  line(pen, "Statement of rent received", { size: 18, bold: true, gap: 26 });
  for (const [k, v] of provenance(period, scopeLabel, rows.length, sum(rows))) {
    line(pen, `${k}: ${v}`, { size: 9, color: [0.35, 0.35, 0.35], gap: 13 });
  }

  pen.y -= 10;
  line(pen, `Total rent received: ${pdfMoney(sum(rows))}`, { size: 13, bold: true, gap: 22 });

  const monthly = new Map<string, number>();
  for (const r of rows) monthly.set(r.date.slice(0, 7), (monthly.get(r.date.slice(0, 7)) ?? 0) + r.amount);
  if (monthly.size) {
    line(pen, "Month by month", { size: 11, bold: true, gap: 16 });
    for (const key of Array.from(monthly.keys()).sort()) {
      row(pen, [key, pdfMoney(monthly.get(key)!)], [56, 180]);
    }
    pen.y -= 8;
  }

  const render = (title: string, note: string, list: RentReceivedRow[]) => {
    line(pen, title, { size: 11, bold: true, gap: 14 });
    line(pen, note, { size: 8.5, color: [0.4, 0.4, 0.4], gap: 16 });
    line(pen, `Subtotal: ${pdfMoney(sum(list))}   (${list.length} payments)`, { size: 10, bold: true, gap: 18 });
    if (list.length) {
      row(pen, ["Date", "Tenant", "Amount", "Reference"], [56, 130, 300, 380], { bold: true });
      for (const r of list.slice(0, 400)) {
        row(pen, [r.date, r.tenantName.slice(0, 28), pdfMoney(r.amount), (r.reference || "-").slice(0, 24)], [56, 130, 300, 380]);
      }
      if (list.length > 400) {
        line(pen, `... and ${list.length - 400} more. The full list is in the accountant's export.`, {
          size: 8, color: [0.45, 0.45, 0.45], gap: 14,
        });
      }
    }
    pen.y -= 12;
  };

  for (const s of proofOfIncomeSections(rows)) render(s.title, s.note, s.rows);

  return pen.doc.save();
}

/** The chase list — printed, or handed to a manager. */
export async function renderWhoOwesMePdf(data: DocumentData): Promise<Uint8Array> {
  const { queue, scopeLabel } = data;
  const pen = await startPdf();
  line(pen, "Outstanding rent", { size: 18, bold: true, gap: 26 });
  // The chase list is about NOW, not the export period — an owner chasing rent
  // wants who owes today, and dating it to a past range would be misleading.
  for (const [k, v] of [
    ["Hostels", scopeLabel],
    ["Tenants", String(queue.totalTenants)],
    ["Total outstanding", money(queue.totalOutstanding)],
    ["Generated", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })],
    ["Source", "Figures as recorded in Stayo, as at the time of generating"],
  ]) {
    line(pen, `${k}: ${v}`, { size: 9, color: [0.35, 0.35, 0.35], gap: 13 });
  }
  pen.y -= 12;

  for (const group of queue.groups) {
    if (!group.rows.length) continue;
    line(pen, `${group.label} — ${group.count}, ${pdfMoney(group.totalOutstanding)}`, { size: 11, bold: true, gap: 16 });
    row(pen, ["Tenant", "Room", "Hostel", "Amount", "Overdue", "Phone"], [56, 190, 240, 360, 430, 480], { bold: true });
    for (const r of group.rows) {
      row(pen, [
        r.tenantName.slice(0, 24), r.room || "-", r.hostelName.slice(0, 16),
        pdfMoney(r.outstanding), r.daysOverdue > 0 ? `${r.daysOverdue}d` : "-", r.phone || "-",
      ], [56, 190, 240, 360, 430, 480]);
    }
    pen.y -= 10;
  }

  if (!queue.totalTenants) line(pen, "Nothing outstanding. Everyone is paid up.", { size: 11 });

  return pen.doc.save();
}

// ─────────────────────────────────────────────────────────────────────────────


export const RENDERERS: Record<ExportDocumentId, (data: DocumentData) => Promise<Uint8Array>> = {
  accountant: renderAccountantWorkbook,
  reconciliation: renderReconciliationWorkbook,
  proof_of_income: renderProofOfIncomePdf,
  who_owes_me: renderWhoOwesMePdf,
};
