import { prisma } from "@/lib/db";
import { ownerPayoutReadModel } from "@/src/services/settlements/owner-payout-read-model";
import { collectionQueueService } from "@/lib/services/collection-queue/collection-queue-service";
import {
  buildExpenseLedgerWhere,
  resolveExpenseSort,
} from "@/lib/services/expenses/expense-ledger-query";
import type { ExpenseQueryParams, ExportParams } from "./export-params";
import {
  EXPORT_DOCUMENTS, EMPTY_DOCUMENT_DATA, RENDERERS,
  EXPORT_CONTENT_TYPE, exportFilename, describeExpenseFilters,
  type DocumentData, type ExportDocumentId, type ExpenseRow,
} from "./export-documents";

/**
 * Fetching the rows each document needs.
 *
 * Everything composes the read models and query builders the screens already
 * use — an exported total that disagreed with the total on screen would destroy
 * the trust the whole Money section was built to earn. Expenses in particular
 * go through `buildExpenseLedgerWhere`, the one builder the list route uses
 * (ADR-009); this service previously ran its own filter-less `findMany`, so an
 * owner who had searched and filtered got a file containing everything.
 *
 * Rendering lives next door in `export-documents.ts`, which imports no I/O and
 * is tested without a database.
 */

export { EXPORT_DOCUMENTS, EXPORT_CONTENT_TYPE, exportFilename };
export type { ExportDocumentId, DocumentData };

export type { ExpenseQueryParams };

export type ExportRequest = ExportParams & { ownerId: string };

export type ExportPreview = {
  count: number;
  total: number;
  noun: string;
  /** The other half of a two-sheet export. Absent for a single-sheet one. */
  secondary?: { count: number; total: number; noun: string };
};

/**
 * The most rows an export will put in one file.
 *
 * The service this replaced streamed in 500-row batches because a year of
 * expenses is not guaranteed to be small, and the route's `maxDuration` is 60s.
 * A cap is the simpler answer, but only if it announces itself — the Report
 * sheet prints "Rows shown 20,000 of 61,204" rather than silently handing over
 * a file that looks complete.
 */
export const EXPENSE_ROW_CAP = 20_000;

function expenseFilters(req: ExportRequest) {
  return {
    hostelId: req.hostelId ?? undefined,
    scope: req.scope ?? undefined,
    // `null` travels: it is how "all time" says it has no lower bound.
    startDate: req.period.from,
    endDate: req.period.to,
    status: req.expenses.status,
    search: req.expenses.search,
    vendor: req.expenses.vendor,
    paymentMethod: req.expenses.paymentMethod,
    amountMin: req.expenses.amountMin,
    amountMax: req.expenses.amountMax,
    recurring: req.expenses.recurring,
  };
}

async function expenseRows(
  req: ExportRequest,
  names: Map<string, string>,
): Promise<{ rows: ExpenseRow[]; truncatedFrom: number | null }> {
  const { where } = buildExpenseLedgerWhere(req.ownerId, expenseFilters(req));
  const [total, records] = await Promise.all([
    prisma.expenses.count({ where }),
    prisma.expenses.findMany({
      where,
      orderBy: resolveExpenseSort(req.expenses.sort),
      take: EXPENSE_ROW_CAP,
      select: {
        date: true, title: true, category: true, amount: true,
        vendor_name: true, payment_method: true, status: true,
        is_recurring: true, notes: true, hostel_id: true,
      },
    }),
  ]);

  const rows: ExpenseRow[] = (records as any[]).map((e) => ({
    date: new Date(e.date).toISOString().slice(0, 10),
    title: e.title ?? "",
    category: e.category ?? "",
    amount: Number(e.amount) || 0,
    vendor: e.vendor_name ?? "",
    method: e.payment_method ?? "",
    status: e.status ?? "",
    recurring: Boolean(e.is_recurring),
    hostelName: e.hostel_id ? names.get(e.hostel_id) ?? "" : "Business (HQ)",
    notes: e.notes ?? "",
  }));

  return { rows, truncatedFrom: total > rows.length ? total : null };
}

async function hostelNames(ownerId: string): Promise<Map<string, string>> {
  const rows = await prisma.hostels.findMany({
    where: { owner_id: ownerId },
    select: { id: true, name: true },
  });
  return new Map(rows.map((h: any) => [h.id, h.name]));
}

async function owedNow(req: ExportRequest) {
  // The chase list is about NOW, not the export period: an owner chasing rent
  // wants to know who owes today, and dating it to a past range would mislead him.
  const queue = await collectionQueueService.getQueue({
    ownerId: req.ownerId,
    hostelFilter: req.hostelId,
  });
  return {
    totalTenants: queue.totalTenants,
    totalOutstanding: queue.totalOutstanding,
    rows: queue.groups.flatMap((g: any) =>
      g.rows.map((r: any) => ({
        tenantName: r.tenantName,
        room: r.room,
        hostelName: r.hostelName,
        outstanding: r.outstanding,
        daysOverdue: r.daysOverdue,
        priority: g.label,
        phone: r.phone,
        lastPaymentAt: r.lastPaymentAt ? String(r.lastPaymentAt).slice(0, 10) : "",
      })),
    ),
  };
}

/**
 * What would be in that file, before anything is generated.
 *
 * The sheet says "1,247 payments · ₹14,80,000" so an owner sending a year's
 * collections to his accountant can tell it is the right thing without opening
 * it. Finding out afterwards costs him a second phone call.
 */
export async function previewExport(req: ExportRequest): Promise<ExportPreview> {
  switch (req.document) {
    case "expenses": {
      const { where } = buildExpenseLedgerWhere(req.ownerId, expenseFilters(req));
      const [count, agg] = await Promise.all([
        prisma.expenses.count({ where }),
        prisma.expenses.aggregate({ where, _sum: { amount: true } }),
      ]);
      return { count, total: Number(agg._sum.amount || 0), noun: "expenses" };
    }
    case "collections": {
      const [rent, queue] = await Promise.all([
        ownerPayoutReadModel.rentReceived(req.ownerId, req.period, req.hostelId),
        collectionQueueService.getQueue({ ownerId: req.ownerId, hostelFilter: req.hostelId }),
      ]);
      return {
        count: rent.length,
        total: rent.reduce((s, r) => s + r.amount, 0),
        noun: "payments",
        secondary: {
          count: queue.totalTenants,
          total: queue.totalOutstanding,
          noun: "tenants still owe",
        },
      };
    }
    case "finance": {
      const names = await hostelNames(req.ownerId);
      const [rent, expenses] = await Promise.all([
        ownerPayoutReadModel.rentReceived(req.ownerId, req.period, req.hostelId),
        expenseRows(req, names),
      ]);
      return {
        count: rent.length,
        total: rent.reduce((s, r) => s + r.amount, 0),
        noun: "payments",
        secondary: {
          count: expenses.rows.length,
          total: expenses.rows.reduce((s, e) => s + e.amount, 0),
          noun: "expenses",
        },
      };
    }
  }
}

/** Fetch everything the chosen document needs, and nothing it does not. */
export async function gatherDocumentData(
  req: ExportRequest,
  generatedAt: Date = new Date(),
): Promise<DocumentData> {
  const names = await hostelNames(req.ownerId);
  const scopeLabel = req.scope === "business"
    ? "Business (HQ)"
    : req.hostelId
      ? names.get(req.hostelId) ?? "One hostel"
      : "All hostels";

  const base: DocumentData = {
    period: req.period,
    scopeLabel,
    generatedAt,
    ...EMPTY_DOCUMENT_DATA,
  };

  if (req.document === "expenses") {
    const { rows, truncatedFrom } = await expenseRows(req, names);
    return {
      ...base,
      expenses: rows,
      truncatedFrom,
      filterLabels: describeExpenseFilters(req.expenses),
    };
  }

  if (req.document === "collections") {
    const [rent, owed] = await Promise.all([
      ownerPayoutReadModel.rentReceived(req.ownerId, req.period, req.hostelId),
      owedNow(req),
    ]);
    return { ...base, rent, owed };
  }

  const [rent, expenses] = await Promise.all([
    ownerPayoutReadModel.rentReceived(req.ownerId, req.period, req.hostelId),
    expenseRows(req, names),
  ]);
  return { ...base, rent, expenses: expenses.rows, truncatedFrom: expenses.truncatedFrom };
}

export async function generateExport(
  req: ExportRequest,
): Promise<{ body: Uint8Array; filename: string; contentType: string }> {
  const data = await gatherDocumentData(req);
  const body = await RENDERERS[req.document](data);
  return { body, filename: exportFilename(req), contentType: EXPORT_CONTENT_TYPE };
}
