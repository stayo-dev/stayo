import { prisma } from "@/lib/db";
import { ownerPayoutReadModel } from "@/src/services/settlements/owner-payout-read-model";
import { collectionQueueService } from "@/lib/services/collection-queue/collection-queue-service";
import type { Period } from "./financial-year";
import {
  EXPORT_DOCUMENTS, EMPTY_DOCUMENT_DATA, RENDERERS,
  exportFilename, exportContentType,
  type DocumentData, type ExportDocumentId,
} from "./export-documents";

/**
 * Fetching the rows each document needs.
 *
 * Everything composes the read models the screens already use — an exported
 * total that disagreed with the total on screen would destroy the trust the
 * whole Money section was built to earn. Rendering lives next door in
 * `export-documents.ts`, which imports no I/O and is tested without a database.
 */

export { EXPORT_DOCUMENTS, exportFilename, exportContentType };
export type { ExportDocumentId, DocumentData };

export type ExportRequest = {
  ownerId: string;
  document: ExportDocumentId;
  period: Period;
  hostelId: string | null;
};

export type ExportPreview = { count: number; total: number; noun: string };

async function expensesInPeriod(req: ExportRequest) {
  return prisma.expenses.findMany({
    where: {
      owner_id: req.ownerId,
      date: { gte: new Date(req.period.from), lte: new Date(req.period.to) },
      ...(req.hostelId ? { hostel_id: req.hostelId } : {}),
    },
    select: {
      date: true, title: true, category: true, amount: true,
      vendor_name: true, payment_method: true, status: true, hostel_id: true,
    },
    orderBy: { date: "asc" },
  });
}

async function hostelNames(ownerId: string): Promise<Map<string, string>> {
  const rows = await prisma.hostels.findMany({
    where: { owner_id: ownerId },
    select: { id: true, name: true },
  });
  return new Map(rows.map((h: any) => [h.id, h.name]));
}

/**
 * What would be in that file, before anything is generated.
 *
 * The sheet says "1,247 payments · Rs. 14,80,000" so an owner sending a year's
 * rent register to his accountant can tell it is the right thing without
 * opening it. Finding out afterwards costs him a second phone call.
 */
export async function previewExport(req: ExportRequest): Promise<ExportPreview> {
  switch (req.document) {
    case "accountant":
    case "proof_of_income": {
      const rows = await ownerPayoutReadModel.rentReceived(req.ownerId, req.period, req.hostelId);
      return { count: rows.length, total: rows.reduce((s, r) => s + r.amount, 0), noun: "payments" };
    }
    case "reconciliation": {
      const payouts = await ownerPayoutReadModel.payoutsForPeriod(req.ownerId, req.period);
      return { count: payouts.length, total: payouts.reduce((s, p) => s + p.amount, 0), noun: "payouts" };
    }
    case "who_owes_me": {
      const queue = await collectionQueueService.getQueue({
        ownerId: req.ownerId,
        hostelFilter: req.hostelId,
      });
      return { count: queue.totalTenants, total: queue.totalOutstanding, noun: "tenants" };
    }
  }
}

/** Fetch everything the chosen document needs, and nothing it does not. */
export async function gatherDocumentData(req: ExportRequest): Promise<DocumentData> {
  const names = await hostelNames(req.ownerId);
  const scopeLabel = req.hostelId ? names.get(req.hostelId) ?? "One hostel" : "All hostels";
  const base: DocumentData = { period: req.period, scopeLabel, ...EMPTY_DOCUMENT_DATA };

  if (req.document === "accountant") {
    const [rent, expenses] = await Promise.all([
      ownerPayoutReadModel.rentReceived(req.ownerId, req.period, req.hostelId),
      expensesInPeriod(req),
    ]);
    return {
      ...base,
      rent,
      expenses: (expenses as any[]).map((e) => ({
        date: new Date(e.date).toISOString().slice(0, 10),
        title: e.title ?? "",
        category: e.category ?? "",
        amount: Number(e.amount) || 0,
        vendor: e.vendor_name ?? "",
        method: e.payment_method ?? "",
        status: e.status ?? "",
        hostelName: e.hostel_id ? names.get(e.hostel_id) ?? "" : "Business (HQ)",
      })),
    };
  }

  if (req.document === "proof_of_income") {
    return { ...base, rent: await ownerPayoutReadModel.rentReceived(req.ownerId, req.period, req.hostelId) };
  }

  if (req.document === "reconciliation") {
    return { ...base, payouts: await ownerPayoutReadModel.payoutsForPeriod(req.ownerId, req.period) };
  }

  // The chase list is about NOW, not the export period: an owner chasing rent
  // wants to know who owes today, and dating it to a past range would mislead him.
  const queue = await collectionQueueService.getQueue({
    ownerId: req.ownerId,
    hostelFilter: req.hostelId,
  });
  return {
    ...base,
    queue: {
      totalTenants: queue.totalTenants,
      totalOutstanding: queue.totalOutstanding,
      groups: queue.groups.map((g: any) => ({
        label: g.label,
        count: g.count,
        totalOutstanding: g.totalOutstanding,
        rows: g.rows.map((r: any) => ({
          tenantName: r.tenantName,
          room: r.room,
          hostelName: r.hostelName,
          outstanding: r.outstanding,
          daysOverdue: r.daysOverdue,
          phone: r.phone,
        })),
      })),
    },
  };
}

export async function generateExport(
  req: ExportRequest,
): Promise<{ body: Uint8Array; filename: string; contentType: string }> {
  const data = await gatherDocumentData(req);
  const body = await RENDERERS[req.document](data);
  return { body, filename: exportFilename(req), contentType: exportContentType(req.document) };
}
