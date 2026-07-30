import { prisma } from "@/lib/db";
import { correctionRegistry } from "../../recovery/correction-registry";
import { reverseObligationPayment } from "./payment-correction-shared";
import type {
  CaseDraft,
  CorrectionCaseRecord,
  CorrectionHandler,
  ImpactReport,
  OperationContext,
} from "../../recovery/types";

interface PaymentReversalDetail {
  paymentId: string;
}

async function loadPayment(paymentId: string) {
  return prisma.payments.findUniqueOrThrow({
    where: { id: paymentId },
    include: { obligation: true },
  });
}

export const paymentReversalHandler: CorrectionHandler<PaymentReversalDetail> = {
  caseType: "PAYMENT_REVERSAL",
  domain: "PAYMENTS",
  tier: "FINANCIAL_CORRECTION",

  policy: {
    canPreview: async () => true,
    canExecute: async (kase: CorrectionCaseRecord<PaymentReversalDetail>) => {
      const payment = await prisma.payments.findUnique({ where: { id: kase.caseDetail.paymentId } });
      if (!payment) return { allowed: false, reason: "Payment no longer exists" };
      if (payment.hostel_id !== kase.hostelId) {
        return { allowed: false, reason: "Payment does not belong to this hostel" };
      }
      return { allowed: true };
    },
  },

  async createCase(ctx: OperationContext): Promise<CaseDraft<PaymentReversalDetail>> {
    const paymentId = String(ctx.input.paymentId);
    const payment = await loadPayment(paymentId);

    if (payment.hostel_id !== ctx.hostelId) {
      throw new Error(`Payment ${paymentId} does not belong to hostel ${ctx.hostelId}`);
    }

    return {
      domain: "PAYMENTS",
      tier: "FINANCIAL_CORRECTION",
      entityRefs: [
        { type: "payment", id: payment.id },
        { type: "obligation", id: payment.obligation_id },
      ],
      beforeSnapshot: {
        payment: { id: payment.id, amount_paid: Number(payment.amount_paid) },
        obligation: { id: payment.obligation.id, settlement_status: payment.obligation.settlement_status },
      },
      caseDetail: { paymentId: payment.id },
      // Keyed on paymentId only (not a timestamp) so a payment can only ever
      // have ONE reversal case — this is what enforces "no double-correct".
      idempotencyKey: `PAYMENT_REVERSAL:${payment.id}`,
    };
  },

  async computeImpact(kase: CorrectionCaseRecord<PaymentReversalDetail>): Promise<ImpactReport> {
    const payment = await loadPayment(kase.caseDetail.paymentId);
    const allPayments = await prisma.payments.findMany({
      where: { obligation_id: payment.obligation_id },
      select: { amount_paid: true },
    });
    const totalPaid = allPayments.reduce((sum: number, p: { amount_paid: any }) => sum + Number(p.amount_paid), 0);
    const outstandingBefore = Math.max(Number(payment.obligation.amount) - totalPaid, 0);
    const outstandingAfter = outstandingBefore + Number(payment.amount_paid);

    // Mirror reverseObligationPayment's ledger-debit condition: only
    // ADVANCE/SECURITY_DEPOSIT obligations had a matching original ledger
    // credit to undo (see settlement-engine.ts), so the preview should only
    // promise a ledger entry when execute will actually create one.
    const obligationHadLedgerCredit =
      payment.obligation.obligation_type === "ADVANCE" || payment.obligation.obligation_type === "SECURITY_DEPOSIT";

    return {
      balanceChanges: [
        { entityType: "obligation", entityId: payment.obligation_id, before: { outstanding: outstandingBefore }, after: { outstanding: outstandingAfter } },
      ],
      obligationChanges: [
        { obligationId: payment.obligation_id, before: { outstanding: outstandingBefore }, after: { outstanding: outstandingAfter } },
      ],
      ledgerEntries: obligationHadLedgerCredit
        ? [
            { direction: "DEBIT", reason: "LEDGER_CORRECTION", amount: Number(payment.amount_paid), tenantId: payment.tenant_id },
          ]
        : [],
      affectedReports: ["Owner Dashboard", "Tenant Statement"],
      notifications: [],
      warnings: [],
    };
  },

  async execute(tx: any, kase: CorrectionCaseRecord<PaymentReversalDetail>, actor) {
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: kase.caseDetail.paymentId } });

    const result = await reverseObligationPayment(tx, {
      hostelId: kase.hostelId,
      payment,
      correctionCaseId: kase.id,
      actorId: actor.actorId,
      reason: kase.reason,
    });

    return {
      reversalPaymentId: result.reversalPaymentId,
      ledgerEntryId: result.ledgerEntryId,
      obligationId: payment.obligation_id,
      newSettlementStatus: result.newSettlementStatus,
    };
  },

  affectedEntities(kase: CorrectionCaseRecord<PaymentReversalDetail>) {
    return kase.entityRefs;
  },
};

correctionRegistry.register(paymentReversalHandler);
