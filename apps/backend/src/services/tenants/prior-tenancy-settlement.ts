import crypto from "crypto";
import { logger } from "@/lib/logger";
import { resolvePriorTenancyPayment } from "@/lib/billing/prior-tenancy-payment";
import { financialPaymentFacade } from "../payments/financial-payment-facade";

/** Mirrors `initializeOnboardingFinancials`'s own `dueDay` default. See the preview route. */
const ONBOARDING_BACKFILL_DUE_DAY = 5;

/**
 * Records what an already-resident tenant had already paid, at the moment they
 * are invited.
 *
 * The obligations themselves are not created here — `onboardingFinancialsService`
 * already raises one RENT row per elapsed month, plus deposit and maintenance,
 * and has done since the "Settle at Invite" work. What was missing was the
 * other half: the owner could say a tenant moved in four months ago, and the
 * system would raise four months of rent and a deposit and then chase the
 * tenant for all of it, because nothing had ever recorded the money that had
 * genuinely changed hands. The deposit case is the sharp one — at move-out the
 * settlement refunds the deposit it has a record of, so a deposit paid before
 * Stayo was asked for twice and returned never.
 *
 * Runs inside the invitation transaction, so a tenancy and the history that
 * explains it commit together or not at all. See ADR-141.
 */
export const priorTenancySettlement = {
  async settleInTx(
    tx: any,
    params: {
      tenantId: string;
      ownerId: string;
      hostelId: string;
      joiningDate: Date;
      monthlyRent: number;
      securityDeposit: number;
      maintenanceCharge: number;
      maintenanceType: string;
      rentPaidThrough: string | null;
      depositPaid: boolean;
      maintenancePaid: boolean;
      /** Profile id of the owner, for `created_by` and the audit note. */
      recordedBy: string;
    }
  ): Promise<{ amountSettled: number; obligationsTouched: number }> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // The same conversion the owner was shown in the preview — one module,
    // called by both, so the number they approved is the number recorded.
    const plan = resolvePriorTenancyPayment({
      joiningDate: params.joiningDate,
      today,
      monthlyRent: params.monthlyRent,
      securityDeposit: params.securityDeposit,
      maintenanceCharge: params.maintenanceCharge,
      maintenanceType: params.maintenanceType,
      dueDay: ONBOARDING_BACKFILL_DUE_DAY,
      rentPaidThrough: params.rentPaidThrough,
      depositPaid: params.depositPaid,
      maintenancePaid: params.maintenancePaid,
    });

    if (plan.amountPaid <= 0) return { amountSettled: 0, obligationsTouched: 0 };

    const outstanding = await tx.rent_obligations.findMany({
      where: {
        tenant_id: params.tenantId,
        hostel_id: params.hostelId,
        is_superseded: false,
      },
      select: { id: true, obligation_type: true },
    });

    // When the deposit has *not* been paid it is excluded from the allocation
    // set entirely, exactly as `buildInviteSettlementPreview` does with
    // `amountIncludesDeposit: false`. Without this the money would land on the
    // deposit first — SECURITY_DEPOSIT is priority 1 in SETTLEMENT_PRIORITY —
    // and the owner would be told the rent they said was paid is still owed.
    const targets = outstanding
      .filter((o: any) => plan.amountIncludesDeposit || o.obligation_type !== "SECURITY_DEPOSIT")
      .map((o: any) => o.id);

    if (targets.length === 0) return { amountSettled: 0, obligationsTouched: 0 };

    const note = `Recorded at invite: already paid before joining Stayo. Entered by ${params.recordedBy}.`;

    // Through the real settlement path, so priority-tiered FIFO allocation,
    // status transitions and the ledger behave exactly as they do for money
    // collected today. Composed, not reimplemented — CLAUDE.md's rule for
    // financial surfaces.
    //
    // Deliberately NOT via `paymentService.recordPayment`, which fires
    // `payment_recorded` after commit: that event drives receipts and the
    // tenant's payment confirmation, and somebody joining today must not be
    // sent a stack of "payment received" messages for money they handed over
    // months ago.
    const result = await financialPaymentFacade.receivePayment(
      tx,
      {
        hostelId: params.hostelId,
        tenantId: params.tenantId,
        amountPaid: plan.amountPaid,
        paymentMethod: "OFFLINE",
        // Attributed to the move-in: this is money that changed hands then,
        // and dating it today would report it as revenue collected this month.
        paymentDate: params.joiningDate,
        ownerId: params.ownerId,
        userId: params.recordedBy,
        offlineRecordedBy: params.recordedBy,
        offlineRecordedAt: today,
        offlineNote: note,
        obligationIdFilter: targets,
      },
      crypto.randomUUID()
    );

    logger.info("invite.prior_history_settled", {
      tenant_id: params.tenantId,
      hostel_id: params.hostelId,
      amount: plan.amountPaid,
      obligations: result.allocations.length,
      months_planned: plan.months.length,
      truncated: plan.truncated,
    });

    return { amountSettled: plan.amountPaid, obligationsTouched: result.allocations.length };
  },
};
