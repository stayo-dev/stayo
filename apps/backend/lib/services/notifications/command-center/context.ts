/**
 * Data gathering for the resident/guardian command center.
 *
 * Every number here is *composed*, never recomputed. `financialReadModelService`
 * is already the canonical answer to "what does this tenant owe, why, and what
 * is the state of their account" — it exists precisely because six surfaces
 * once each recalculated overlapping slices of that and disagreed with one
 * another (see `docs/business-logic/financial-consistency-investigation-report.md`).
 * WhatsApp was one of the surfaces that drifted. It is not going to be one
 * again: this module reads the model and shapes it for a phone screen, and the
 * moment it starts summing obligations itself, that guarantee is gone.
 *
 * The one thing it adds is instalment *position*, which no existing surface
 * presented — assembled from `installment_sequence` on the obligations and
 * `installment_count` on the active billing plan, both already in the schema.
 */

import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { financialReadModelService, type FinancialReadModel } from "@/src/services/payments/financial-read-model-service";
import { receiptService } from "@/src/services/payments/receipt-service";
import type { Subject } from "./voice";
import type { RentComponent, RentSummaryInput } from "./rent-summary";
import type { InstalmentPlanInput, InstalmentRow, InstalmentState } from "./installment-plan";
import type { PaymentRecord, ReceiptInput } from "./receipt";

const logger = getLogger("whatsapp.command-center.context");

/** Everything a command handler needs about one resident, loaded once. */
export type ResidentContext = {
  tenantId: string;
  ownerId: string;
  hostelId: string;
  subject: Subject;
  financials: FinancialReadModel;
};

/**
 * Load the resident and their money in one pass.
 *
 * Returns `null` for a tenant who is no longer ACTIVE or INVITED — the same
 * liveness filter identity resolution applies, kept identical so a resident
 * cannot be routable by one and invisible to the other.
 */
export async function loadResidentContext(tenantId: string): Promise<ResidentContext | null> {
  const tenant = await prisma.tenants.findFirst({
    where: { id: tenantId, status: { in: ["ACTIVE", "INVITED"] } },
    select: {
      id: true,
      owner_id: true,
      hostel_id: true,
      guardian_name: true,
      profiles: { select: { name: true } },
      hostels: { select: { name: true } },
    },
  });

  if (!tenant) return null;

  const allocation = await prisma.roomAllocation.findFirst({
    where: { tenant_id: tenant.id },
    orderBy: { created_at: "desc" },
    select: { room: { select: { room_no: true } } },
  });

  const financials = await financialReadModelService.getFinancialReadModel(
    tenant.id,
    tenant.owner_id ?? undefined,
    tenant.hostel_id
  );

  return {
    tenantId: tenant.id,
    ownerId: tenant.owner_id as string,
    hostelId: tenant.hostel_id,
    subject: {
      name: tenant.profiles?.name?.trim() || "the resident",
      // The hostel's own name is the authority anchor on every money message
      // (voice.ts rule 2). "Your hostel" is a fallback that should never fire.
      hostelName: tenant.hostels?.name?.trim() || "Your hostel",
      roomNo: allocation?.room?.room_no || null,
    },
    financials,
  };
}

/** A short, readable name for what one obligation is. */
function componentLabel(item: FinancialReadModel["items"][number]): string {
  if (item.installment_label) return String(item.installment_label);
  switch (item.type) {
    case "SECURITY_DEPOSIT":
    case "ADVANCE":
      return "Security deposit";
    case "MAINTENANCE":
      return "Maintenance";
    case "RENT":
    default: {
      const month = item.rent_month
        ? new Intl.DateTimeFormat("en-IN", {
            month: "long",
            year: "numeric",
            timeZone: "Asia/Kolkata",
          }).format(new Date(item.rent_month))
        : null;
      return month ? `Rent — ${month}` : "Rent";
    }
  }
}

/** Currently-payable items only: exactly what `PAY` will charge for. */
function payableItems(financials: FinancialReadModel) {
  return financials.items
    .filter((item) => item.legacy_status !== "UPCOMING" && item.outstanding > 0)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
}

/** The soonest bill that has not been activated yet. */
function nextUpcoming(financials: FinancialReadModel) {
  return financials.items
    .filter((item) => item.legacy_status === "UPCOMING")
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];
}

async function loadPlanTotals(tenantId: string) {
  const plan = await prisma.tenant_billing_plans.findFirst({
    where: { tenant_id: tenantId, status: "ACTIVE" },
    orderBy: { effective_from: "desc" },
    select: { installment_count: true, total_contract_amount: true },
  });

  return {
    totalInstalments: plan?.installment_count ?? null,
    totalContractAmount: plan?.total_contract_amount ? Number(plan.total_contract_amount) : null,
  };
}

/** Lifetime paid, straight from the payment rows. */
async function loadTotalPaid(tenantId: string): Promise<number> {
  const aggregate = await prisma.payments.aggregate({
    where: { tenant_id: tenantId },
    _sum: { amount_paid: true },
  });
  return Number(aggregate._sum.amount_paid || 0);
}

/** Build the `RENT` input. Subject and audience are supplied by the caller. */
export async function buildRentSummary(
  context: ResidentContext
): Promise<Omit<RentSummaryInput, "audience" | "subject">> {
  const { financials } = context;
  const payable = payableItems(financials);
  const upcoming = nextUpcoming(financials);
  const { totalInstalments } = await loadPlanTotals(context.tenantId);

  const components: RentComponent[] = payable.map((item) => ({
    label: componentLabel(item),
    amount: item.outstanding,
    dueDate: item.due_date,
    overdueDays: item.overdue_days,
  }));

  // Where they stand in the schedule: the oldest still-open instalment if
  // there is one, otherwise the next scheduled one.
  const positionItem =
    payable.find((item) => item.installment_sequence != null) ||
    (upcoming?.installment_sequence != null ? upcoming : undefined);

  return {
    payableNow: financials.current_payable_amount,
    overdueAmount: financials.overdue_amount,
    lateFeesDue: financials.current_payable_breakdown.late_fees,
    overdueDays: financials.overdue_days,
    components,
    nextDue: upcoming ? { amount: upcoming.amount, date: upcoming.due_date } : null,
    instalment:
      positionItem?.installment_sequence != null && totalInstalments
        ? { sequence: Number(positionItem.installment_sequence), total: totalInstalments }
        : null,
    fullySettled: financials.total_due <= 0,
  };
}

function instalmentState(item: FinancialReadModel["items"][number]): InstalmentState {
  if (item.outstanding <= 0) return "PAID";
  if (item.legacy_status === "UPCOMING") return "UPCOMING";
  if (item.is_overdue) return "OVERDUE";
  if (item.paid > 0) return "PARTIAL";
  return "DUE";
}

/**
 * Build the `PLAN` input.
 *
 * Deposits and maintenance are excluded: an instalment schedule is the rent
 * agreement, and mixing a one-off security deposit into "3 of 12" makes the
 * count wrong in a way a parent would reasonably act on.
 */
export async function buildInstalmentPlan(
  context: ResidentContext
): Promise<Omit<InstalmentPlanInput, "audience" | "subject">> {
  const [{ totalInstalments, totalContractAmount }, totalPaid] = await Promise.all([
    loadPlanTotals(context.tenantId),
    loadTotalPaid(context.tenantId),
  ]);

  const rentItems = context.financials.items
    .filter((item) => item.type === "RENT")
    .sort((a, b) => {
      const seqA = a.installment_sequence ?? Number.MAX_SAFE_INTEGER;
      const seqB = b.installment_sequence ?? Number.MAX_SAFE_INTEGER;
      if (seqA !== seqB) return seqA - seqB;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });

  const rows: InstalmentRow[] = rentItems.map((item, index) => ({
    // Fall back to ordinal position when the obligation carries no sequence —
    // month-to-month tenants have no billing plan and therefore no numbering,
    // but "4th payment of the stay" is still true and still useful.
    sequence: item.installment_sequence != null ? Number(item.installment_sequence) : index + 1,
    label: componentLabel(item),
    amount: item.amount,
    paid: item.paid,
    outstanding: item.outstanding,
    dueDate: item.due_date,
    state: instalmentState(item),
    overdueDays: item.overdue_days,
  }));

  return { rows, totalInstalments, totalContractAmount, totalPaid };
}

/** Build the `RECEIPT` input from the most recent payment. */
export async function buildReceipt(
  context: ResidentContext
): Promise<Omit<ReceiptInput, "audience" | "subject">> {
  const [payment, totalPaid] = await Promise.all([
    prisma.payments.findFirst({
      where: { tenant_id: context.tenantId },
      orderBy: [{ payment_date: "desc" }, { created_at: "desc" }],
      select: {
        amount_paid: true,
        payment_date: true,
        payment_method: true,
        reference_number: true,
        obligation: { select: { obligation_type: true, rent_month: true, installment_label: true } },
        receipts: { select: { receipt_number: true } },
      },
    }),
    loadTotalPaid(context.tenantId),
  ]);

  const record: PaymentRecord | null = payment
    ? {
        amount: Number(payment.amount_paid),
        paidOn: payment.payment_date,
        towards: payment.obligation
          ? componentLabel({
              type: payment.obligation.obligation_type || "RENT",
              rent_month: payment.obligation.rent_month,
              installment_label: payment.obligation.installment_label ?? null,
            } as FinancialReadModel["items"][number])
          : null,
        reference: payment.receipts?.receipt_number || payment.reference_number || null,
        // Receipt documents are issued behind an authenticated route, so no URL
        // is handed to a guardian here. The receipt number is the durable
        // reference; the hostel can produce the document against it.
        receiptUrl: null,
        method: payment.payment_method || null,
      }
    : null;

  return {
    payment: record,
    totalPaid,
    stillDue: context.financials.current_payable_amount,
  };
}

/** One payment, shaped for the "which payment?" picker and for a receipt reply. */
export type PaymentSummary = {
  paymentId: string;
  amount: number;
  paidOn: Date | null;
  towards: string | null;
  method: string | null;
  /** The issued receipt number, when a receipt row already exists. */
  receiptNumber: string | null;
};

/**
 * The payments a reader can ask for a receipt about, newest first.
 *
 * Capped at the picker's own ceiling plus one, so the caller can say "showing
 * your most recent N" truthfully without loading a whole tenancy's history.
 */
export async function listPayments(tenantId: string, limit = 10): Promise<PaymentSummary[]> {
  const rows = await prisma.payments.findMany({
    where: { tenant_id: tenantId },
    orderBy: [{ payment_date: "desc" }, { created_at: "desc" }],
    take: limit,
    select: {
      id: true,
      amount_paid: true,
      payment_date: true,
      payment_method: true,
      obligation: { select: { obligation_type: true, rent_month: true, installment_label: true } },
      receipts: { select: { receipt_number: true } },
    },
  });

  return rows.map((row: any) => ({
    paymentId: String(row.id),
    amount: Number(row.amount_paid),
    paidOn: row.payment_date || null,
    towards: row.obligation
      ? componentLabel({
          type: row.obligation.obligation_type || "RENT",
          rent_month: row.obligation.rent_month,
          installment_label: row.obligation.installment_label ?? null,
        } as FinancialReadModel["items"][number])
      : null,
    method: row.payment_method || null,
    receiptNumber: row.receipts?.receipt_number || null,
  }));
}

/** One payment by id, scoped to the tenant so a payload can't reach another. */
export async function findPayment(tenantId: string, paymentId: string): Promise<PaymentSummary | null> {
  const row = await prisma.payments.findFirst({
    where: { id: paymentId, tenant_id: tenantId },
    select: {
      id: true,
      amount_paid: true,
      payment_date: true,
      payment_method: true,
      obligation: { select: { obligation_type: true, rent_month: true, installment_label: true } },
      receipts: { select: { receipt_number: true } },
    },
  });

  if (!row) return null;

  return {
    paymentId: String(row.id),
    amount: Number(row.amount_paid),
    paidOn: row.payment_date || null,
    towards: row.obligation
      ? componentLabel({
          type: row.obligation.obligation_type || "RENT",
          rent_month: row.obligation.rent_month,
          installment_label: row.obligation.installment_label ?? null,
        } as FinancialReadModel["items"][number])
      : null,
    method: row.payment_method || null,
    receiptNumber: row.receipts?.receipt_number || null,
  };
}

export type ReceiptDocument = {
  /** The rendered PDF itself. Preferred — see `MetaWhatsAppProvider.uploadMedia`. */
  bytes: Buffer | null;
  /** CDN URL, when one genuinely exists. Fallback only. */
  url: string | null;
  receiptNumber: string;
  filename: string;
};

/**
 * `lib/imagekit.ts` mocks uploads when `IMAGEKIT_PRIVATE_KEY` is absent and
 * writes this placeholder into `receipts.receipt_pdf_url`. Sending it to Meta
 * would deliver a link to nothing, so it is treated as no URL at all.
 */
const MOCK_UPLOAD_URL = "ik.imagekit.io/dummy";

/**
 * Make sure a current receipt PDF exists for this payment, and hand back the
 * public URL WhatsApp can attach.
 *
 * `receiptService.generatePdfBuffer` is the canonical "reuse or generate"
 * operation: it creates the `receipts` row if missing, returns the cached PDF
 * when the stored template version is current, and otherwise re-renders and
 * re-uploads to ImageKit. Calling it here rather than reimplementing the
 * staleness check keeps one rule in one place — at the cost of one discarded
 * buffer on a cache hit, which is the right trade against the two copies of
 * that rule drifting apart. `RECEIPT_TEMPLATE_VERSION` is module-private, so
 * checking it ourselves would mean exporting and then duplicating it.
 *
 * Returns `null` rather than throwing: a receipt that cannot be produced is
 * answered with an explanation, never with silence.
 */
export async function ensureReceiptDocument(paymentId: string): Promise<ReceiptDocument | null> {
  let bytes: Buffer | null = null;

  try {
    // These bytes are the deliverable. They were previously rendered and then
    // discarded in favour of a CDN URL, which is what tied receipt delivery to
    // ImageKit being configured at all.
    bytes = await receiptService.generatePdfBuffer(paymentId, { autoCreate: true });
  } catch (error: any) {
    logger.warn("command_center.receipt_render_failed", {
      payment_id: paymentId,
      error: error?.message || String(error),
    });
    // Fall through — a real URL cached by an earlier run may still be usable.
  }

  const receipt = await prisma.receipts.findFirst({
    where: { payment_id: paymentId },
    select: { receipt_number: true, receipt_pdf_url: true },
  });

  const storedUrl = receipt?.receipt_pdf_url || null;
  const url = storedUrl && !storedUrl.includes(MOCK_UPLOAD_URL) ? storedUrl : null;

  if (!bytes && !url) {
    logger.warn("command_center.receipt_unavailable", { payment_id: paymentId });
    return null;
  }

  const receiptNumber = receipt?.receipt_number || "receipt";
  return {
    bytes,
    url,
    receiptNumber,
    // What the reader sees in their chat and their downloads — the receipt
    // number, not a UUID.
    filename: `Receipt-${receiptNumber}.pdf`.replace(/[/\\]/g, "-"),
  };
}

/** Summary line for the resident picker — cheap, no full read model per row. */
export async function loadPickerRows(
  tenantIds: string[]
): Promise<Array<{ tenantId: string; name: string; roomNo: string | null; payableNow: number }>> {
  const tenants = await prisma.tenants.findMany({
    where: { id: { in: tenantIds }, status: { in: ["ACTIVE", "INVITED"] } },
    select: {
      id: true,
      owner_id: true,
      hostel_id: true,
      profiles: { select: { name: true } },
      room_allocations: {
        orderBy: { created_at: "desc" },
        take: 1,
        select: { room: { select: { room_no: true } } },
      },
    },
  });

  return Promise.all(
    tenants.map(async (tenant: any) => {
      let payableNow = 0;
      try {
        const model = await financialReadModelService.getFinancialReadModel(
          tenant.id,
          tenant.owner_id ?? undefined,
          tenant.hostel_id
        );
        payableNow = model.current_payable_amount;
      } catch (error: any) {
        // A picker row that cannot price itself still has to appear — losing
        // the row would hide a resident from their own guardian.
        logger.warn("command_center.picker_row_financials_failed", {
          tenant_id: tenant.id,
          error: error?.message || String(error),
        });
      }

      return {
        tenantId: String(tenant.id),
        name: tenant.profiles?.name?.trim() || "Resident",
        roomNo: tenant.room_allocations?.[0]?.room?.room_no || null,
        payableNow,
      };
    })
  );
}
