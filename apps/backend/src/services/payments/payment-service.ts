import { prisma } from "@/lib/db";
import { isPayable, buildSettlementPlan, toObligationSnapshot, validateChronology, PAYABLE_STATUSES } from "./settlement-planner";
import { rentGenerationService } from "./rent-generation-service";
import { Prisma } from "@prisma/client";
import { eventSystem } from "@/lib/events";
import { PaymentProviderFactory } from "./provider-factory";
import crypto from "crypto";
import { EmailService } from "@/lib/services/email-service";
import { receiptService } from "./receipt-service";
import { getObligationOperationalContext, getPaymentOperationalContext, getTenantOperationalContext, resolveHostelIdFromObligation } from "@/lib/hostel-context";
import { tenantFinancialLedgerService } from "./tenant-financial-ledger-service";
import { formatCurrency, formatMonthYear } from "@/lib/format";
import { eventLog } from "@/lib/services/event-log-service";
import { getLogger } from "@/lib/logger";
import { incrementPayment, incrementWebhook } from "@/lib/metrics";
import { tenantAnalyticsService } from "@/lib/services/tenant-analytics-service";
import { financialService } from "./financial-service";
import { assertSameFinancialHostel, assertScopedEntityHostel, requireFinancialHostelId } from "@/lib/services/financial-isolation";
import { getProviderContext } from "./merchant-context";
import { PAYMENT_DOMAIN, PAYMENT_FLOW, PAYMENT_SCOPE, SETTLEMENT_STATUS, MERCHANT_CONTEXT } from "./financial-domain";
import { paymentStatusEventService } from "@/lib/services/payment-status-event-service";
import { describePaymentReversal } from "./financial-timeline-service";
import { paymentMethodLabel } from "@/lib/payment-method-labels";
import { paymentRepository } from "@/src/repositories/paymentRepository";
import { paymentOperationalAnomalyService } from "@/lib/services/payment-operational-anomaly-service";
import { paymentWebhookEventService } from "@/lib/services/payment-webhook-event-service";
import { paymentProviderVerificationSnapshotService } from "@/lib/services/payment-provider-verification-snapshot-service";
import { backendUrl } from "@/lib/config/domains";
import { activationFinancialStatusService } from "@/src/services/tenants/activation-financial-status-service";
import { getActivePaymentProvider, validatePaymentEnvironment } from "./payment-env";
import { recordCapturedRentInTx } from "@/src/services/settlements/gateway-ledger";
import { notifyTenantPaid } from "@/src/services/settlements/payout-notifications";
import { consumeIdentityTokenInTx } from "./identity-confirmation-guard";
import { financialPaymentFacade } from "./financial-payment-facade";
import { obligationEngine } from "./obligation-engine";
import { financialPolicyEngine } from "./financial-policy-engine";

// Boot-time validation of payment configuration. Deliberately logged rather
// than thrown: this runs at *module import*, so an unconfigured gateway used to
// hard-500 every route that transitively imports this file — including
// read-only ones like /api/payments/tenant-dues, which never touch a gateway.
// Gateway calls still fail loudly at the point of use, where the credentials
// actually matter. Same reasoning as the WhatsApp startup check (ADR-034).
try {
  validatePaymentEnvironment();
} catch (error) {
  console.error(
    "[payment-service] Payment gateway is not configured — online payment routes will fail until it is:",
    error instanceof Error ? error.message : String(error),
  );
}


const logger = getLogger("payment.service");
type MaybeHostelId = string | null;

export class PaymentService {
  // 🔧 FIX C1: Old calculateProratedRent, generateMonthlyRent, previewMonthlyRent DELETED.
  // These were a split-brain duplicate of RentGenerationService with different rules:
  //   - No lock, no P2002 catch, hardcoded due day to 10th, local time instead of UTC.
  // Use rentGenerationService (lib/services/rent-generation-service.ts) exclusively.

  private attemptIdentityData(merchantTxnId: string, result?: any) {
    return {
      merchant_transaction_id: merchantTxnId,
      provider_order_id: result?.provider_order_id || result?.gateway_txn_id || null,
      provider_transaction_id: result?.provider_transaction_id || null,
      provider_reference_id: result?.provider_reference_id || result?.provider_transaction_id || result?.provider_order_id || result?.gateway_txn_id || null,
    };
  }

  private hmsFinancialOwnerId() {
    return process.env.HMS_FINANCIAL_OWNER_ID || null;
  }

  private isPlatformBillingAttempt(attempt: any) {
    return attempt?.payment_domain === PAYMENT_DOMAIN.PLATFORM_BILLING
      || Boolean(attempt?.invoice_id)
      || attempt?.flow_type === PAYMENT_FLOW.SUBSCRIPTION
      || attempt?.flow_type === PAYMENT_FLOW.ADDON;
  }

  private isAddonAttempt(attempt: any) {
    return (attempt?.payment_domain === PAYMENT_DOMAIN.PLATFORM_BILLING
      && attempt?.flow_type === PAYMENT_FLOW.ADDON)
      || attempt?.payment_type === "ADDON";
  }

  private async getTenantOutstandingInTx(tx: any, tenantId: string, hostelId: string | null): Promise<number> {
    if (!hostelId) return 0;
    const obligations = await tx.rent_obligations.findMany({
      where: {
        tenant_id: tenantId,
        hostel_id: hostelId,
        status: { in: PAYABLE_STATUSES },
      },
      include: {
        payments: {
          select: { amount_paid: true },
        },
      },
    });
    let totalOutstanding = 0;
    for (const ob of obligations) {
      const paid = ob.payments.reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
      const outstanding = Math.max(Number(ob.amount) - paid, 0);
      totalOutstanding += outstanding;
    }
    return totalOutstanding;
  }

  private async getTenantLedgerBalanceInTx(tx: any, tenantId: string): Promise<number> {
    const aggregate = await tx.tenant_financial_ledger.findMany({
      where: { tenant_id: tenantId },
      select: { amount: true, type: true },
    });
    return aggregate.reduce((acc: number, entry: any) => {
      const amt = Number(entry.amount);
      return entry.type === "CREDIT" ? acc + amt : acc - amt;
    }, 0);
  }

  /**
   * Record that Razorpay actually put this money in Stayo's account.
   *
   * Called inside every settlement transaction, so the financial record and the
   * operational one commit or roll back together. Without this, Stayo would owe
   * owners money it had no record of holding — which is precisely the state the
   * system was in before: `gateway_transactions` had a settlement engine reading
   * it and nothing at all writing it.
   *
   * Never throws, and — more importantly — never poisons the caller's
   * transaction: the insert runs inside its own savepoint (see
   * `gateway-ledger.ts`), so a failure to write the settlement record cannot
   * roll back a payment the provider has already captured. That would leave the
   * tenant charged with nothing to show for it, trading a reconcilable gap for
   * an unrecoverable one. The catch here is a backstop for anything that is not
   * a SQL error.
   */
  private async recordGatewayCaptureInTx(
    tx: any,
    attempt: any,
    gatewayTxnId: string | undefined,
    rawPayload: any,
  ): Promise<void> {
    try {
      await recordCapturedRentInTx(tx, {
        providerPaymentId: gatewayTxnId,
        amount: Number(attempt.amount),
        ownerId: attempt.owner_id,
        hostelId: attempt.hostel_id ?? null,
        tenantId: attempt.tenant_id ?? null,
        raw: rawPayload ?? null,
      });
    } catch (error: any) {
      logger.error("settlement.gateway_ledger.write_failed", {
        attempt_id: attempt?.id,
        owner_id: attempt?.owner_id,
        error: String(error?.message || error),
      });
    }
  }

  private async validatePaymentAttemptSettlementInTx(
    tx: any,
    params: {
      attemptId: string;
      initialOutstanding: number;
      initialLedgerBalance: number;
      tenantId: string;
      hostelId: string | null;
    }
  ) {
    const { attemptId, initialOutstanding, initialLedgerBalance, tenantId, hostelId } = params;

    const attempt = await tx.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: { payments: true },
    });
    if (!attempt) {
      throw new Error(`INVARIANT_VIOLATION: Payment attempt ${attemptId} not found`);
    }

    if (this.isPlatformBillingAttempt(attempt) || this.isAddonAttempt(attempt)) {
      return;
    }

    if (attempt.status !== "SUCCESS") {
      throw new Error(`INVARIANT_VIOLATION: Payment attempt ${attemptId} is not in SUCCESS status (status is ${attempt.status})`);
    }

    const capturedAmount = Number(attempt.amount);

    // Sum allocations (payments)
    const paymentsAllocations = await tx.payments.findMany({
      where: { payment_attempt_id: attemptId },
    });
    const totalAllocated = paymentsAllocations.reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);

    // Ledger credits tied to this attempt come in two distinct shapes that
    // must NOT be summed together:
    //  - A future-rent-credit topup, keyed directly by attemptId
    //    (removed with future rent credit — ADR-036,
    //    referenceType PAYMENT_ATTEMPT_REMAINDER/PAYMENT_GROUP_REMAINDER).
    //    This is genuinely *unallocated* money — it did not go toward any
    //    obligation, so it belongs on the right-hand side of invariant #1
    //    ("captured = allocated + this").
    //  - A security-deposit/advance "collected" marker, keyed by the
    //    individual `payments` row it accompanies (settlement-engine.ts's
    //    ADVANCE/SECURITY_DEPOSIT branch, referenceType PAYMENT — see its
    //    comment: "the obligation being marked PAID/PARTIAL tracks that the
    //    deposit/advance was billed, while this credit tracks that it was
    //    collected"). This is a *second record of money already counted* in
    //    `totalAllocated` via that same payments row — including it in
    //    invariant #1 would double-count the same rupee. It DOES move the
    //    real ledger_balance, though, so invariant #3 (which checks the
    //    ledger balance actually moved by the right amount) needs it.
    // Using one shared sum for both checks made invariant #1 false-pass (by
    // omission) and invariant #3 false-fail on every gateway payment that
    // allocated into a deposit/advance obligation — the settlement was
    // correct, but this self-check rolled back the whole transaction and
    // returned a 500 despite the provider having captured the charge. See
    // docs/obsidian/Bugs.md.
    const paymentIds = paymentsAllocations.map((p: any) => p.id);
    const [attemptLedgerCredits, depositMirrorCredits] = await Promise.all([
      tx.tenant_financial_ledger.findMany({
        where: { tenant_id: tenantId, reference_id: attemptId, type: "CREDIT" },
      }),
      paymentIds.length > 0
        ? tx.tenant_financial_ledger.findMany({
            where: { tenant_id: tenantId, reference_id: { in: paymentIds }, reference_type: "PAYMENT", type: "CREDIT" },
          })
        : Promise.resolve([]),
    ]);
    const unallocatedLedgerCredited = attemptLedgerCredits.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
    const depositMirrorCredited = depositMirrorCredits.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
    const totalLedgerBalanceMovement = unallocatedLedgerCredited + depositMirrorCredited;

    // Invariants checks:
    // 1. Captured Amount = Obligation Allocations + Net *Unallocated* Ledger Credit
    const totalSettled = totalAllocated + unallocatedLedgerCredited;
    if (Math.abs(totalSettled - capturedAmount) > 0.01) {
      throw new Error(
        `INVARIANT_VIOLATION: Settlement mismatch. Captured: ₹${capturedAmount.toFixed(2)}, ` +
        `Allocated Dues: ₹${totalAllocated.toFixed(2)}, Ledger Credits: ₹${unallocatedLedgerCredited.toFixed(2)}, ` +
        `Total Settled: ₹${totalSettled.toFixed(2)}. Difference: ₹${(capturedAmount - totalSettled).toFixed(2)}`
      );
    }

    // 2. Outstanding Before - Obligation Allocations = Outstanding After
    const finalOutstanding = await this.getTenantOutstandingInTx(tx, tenantId, hostelId);
    const expectedOutstandingAfter = Math.max(0, initialOutstanding - totalAllocated);
    if (Math.abs(finalOutstanding - expectedOutstandingAfter) > 0.01) {
      throw new Error(
        `INVARIANT_VIOLATION: Outstanding accounting inconsistency. ` +
        `Outstanding Before: ₹${initialOutstanding.toFixed(2)}, Allocated: ₹${totalAllocated.toFixed(2)}, ` +
        `Expected Outstanding After: ₹${expectedOutstandingAfter.toFixed(2)}, Actual Outstanding After: ₹${finalOutstanding.toFixed(2)}`
      );
    }

    // 3. Ledger Balance After - Ledger Balance Before = Total Ledger Credit Movement (both shapes)
    const finalLedgerBalance = await this.getTenantLedgerBalanceInTx(tx, tenantId);
    if (Math.abs((finalLedgerBalance - initialLedgerBalance) - totalLedgerBalanceMovement) > 0.01) {
      throw new Error(
        `INVARIANT_VIOLATION: Ledger balance inconsistency. ` +
        `Ledger Balance Before: ₹${initialLedgerBalance.toFixed(2)}, Ledger Balance After: ₹${finalLedgerBalance.toFixed(2)}, ` +
        `Expected Ledger Change: ₹${totalLedgerBalanceMovement.toFixed(2)}, Actual Ledger Change: ₹${(finalLedgerBalance - initialLedgerBalance).toFixed(2)}`
      );
    }
  }

  private async getProviderInstanceForAttempt(attempt: any, label: string) {
    if (this.isPlatformBillingAttempt(attempt)) {
      return {
        instance: PaymentProviderFactory.getProvider(attempt.provider, this.getOwnerLevelProviderConfig()),
        config: this.getOwnerLevelProviderConfig(),
      };
    }

    const hostelId = requireFinancialHostelId(attempt.hostel_id, label);
    const providerContext = await getProviderContext({
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flowType: (attempt as any).flow_type || PAYMENT_FLOW.RENT,
      operationalOwnerId: attempt.owner_id,
      financialOwnerId: attempt.owner_id,
      hostelId,
      scopeType: PAYMENT_SCOPE.HOSTEL,
    });
    return {
      instance: PaymentProviderFactory.getProvider(attempt.provider, providerContext.config),
      config: providerContext.config,
    };
  }

  private mapAttemptWithRawResponse(attempt: any) {
    if (!attempt) return attempt;
    return {
      ...attempt,
      raw_response: attempt.raw_create_response,
    };
  }

  private async updateAttemptStatus(tx: any, params: {
    attemptId: string;
    fromStatus?: string | null;
    toStatus: string;
    source: string;
    reason?: string;
    data?: any;
    actorId?: string | null;
    metadata?: any;
    operationalOwnerId?: string | null;
    financialOwnerId?: string | null;
    hostelId?: MaybeHostelId;
  }) {
    const updated = await tx.paymentAttempt.update({
      where: { id: params.attemptId },
      data: {
        ...(params.data || {}),
        status: params.toStatus,
      },
    });
    await paymentStatusEventService.append(tx, {
      attemptId: params.attemptId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      source: params.source,
      reason: params.reason,
      actorId: params.actorId || null,
      operationalOwnerId: params.operationalOwnerId || updated.owner_id || null,
      financialOwnerId: params.financialOwnerId || updated.owner_id || null,
      hostelId: params.hostelId || updated.hostel_id || null,
      metadata: params.metadata,
    });
    return this.mapAttemptWithRawResponse(updated);
  }

  private async updateAttemptStatusOutsideTx(params: any) {
    return prisma.$transaction((tx) => this.updateAttemptStatus(tx, params));
  }

  // _applyPaymentInTx retired — its 3 callers (recordPayment,
  // recordOfflinePaymentWithToken, finalizePaymentAttempt's single-obligation
  // branch) now route through financialPaymentFacade.receivePayment with
  // obligationIdFilter: [obligationId], the same plan+execute flow every
  // other settlement path uses. Closes two pre-existing gaps this method had:
  // no lifecycle_status/settlement_status dual-write, and overpayment was
  // rejected outright instead of crediting the excess as future credit.

  /**
   * @deprecated orchestration moved to FinancialPaymentFacade.receivePayment.
   * Kept as a thin delegate — name/signature preserved because
   * tests/payment-fifo-settlement.test.ts calls this private method directly
   * (via `as any`) and asserts on its return shape.
   */
  private async _settleTenantRentPaymentInTx(tx: any, data: {
    hostelId: string;
    tenantId: string;
    amountPaid: number;
    paymentMethod: string;
    referenceNumber?: string;
    paymentDate?: Date;
    paymentAttemptId?: string;
    idempotencyKey?: string;
    userId?: string;
    ownerId?: string;
    offlineRecordedBy?: string;
    offlineRecordedAt?: Date;
    offlineRecordedIp?: string;
    offlineNote?: string;
    allowedObligationIds?: string[];
  }, groupId: string) {
    return financialPaymentFacade.receivePayment(tx, data, groupId);
  }

  /**
   * Secure offline payment recording — atomically consumes a single-use identity
   * token and records the payment in one DB transaction.
   *
   * Atomicity guarantee:
   *   - Token consumed (used=true)  ┐
   *   - Payment row created         ├── all-or-nothing
   *   - Obligation status updated   ┘
   *
   * If the payment fails for any reason (over-payment, already PAID, DB error),
   * the transaction rolls back and the identity token remains UNUSED — the owner
   * can retry without re-entering their password.
   */
  async recordOfflinePaymentWithToken(jti: string, data: {
    hostelId: string;
    obligationId: string;
    amountPaid: number;
    paymentMethod: string;
    referenceNumber?: string;
    paymentDate?: Date;
    userId: string;
    ownerId?: string;
    offlineRecordedBy: string;
    offlineRecordedAt: Date;
    offlineRecordedIp?: string;
    offlineNote?: string;
  }) {
    return prisma.$transaction(async (tx: any) => {
      // ── Consume the identity token (atomic, single-use enforcement) ───────
      await consumeIdentityTokenInTx(tx, jti);

      // ── Record payment via the canonical Planner → Plan → Engine flow ─────
      const obligation = await tx.rent_obligations.findUnique({
        where: { id: data.obligationId },
        select: { tenant_id: true },
      });
      if (!obligation) throw new Error("NOT_FOUND: Obligation not found");

      const result = await financialPaymentFacade.receivePayment(tx, {
        hostelId: data.hostelId,
        tenantId: obligation.tenant_id,
        amountPaid: data.amountPaid,
        paymentMethod: data.paymentMethod,
        referenceNumber: data.referenceNumber,
        paymentDate: data.paymentDate,
        ownerId: data.ownerId,
        offlineRecordedBy: data.offlineRecordedBy,
        offlineRecordedAt: data.offlineRecordedAt,
        offlineRecordedIp: data.offlineRecordedIp,
        offlineNote: data.offlineNote,
        obligationIdFilter: [data.obligationId],
      }, crypto.randomUUID());

      const allocation = result.allocations[0];
      if (!allocation) throw new Error("SETTLEMENT_FAILED: Offline payment produced no allocation");

      return {
        payment: {
          id: allocation.payment_id,
          obligation_id: allocation.obligation_id,
          tenant_id: obligation.tenant_id,
          owner_id: allocation.owner_id,
          hostel_id: data.hostelId,
          amount_paid: allocation.allocated,
        },
        newStatus: allocation.new_status,
        tenantId: obligation.tenant_id,
        ownerId: allocation.owner_id,
        hostelId: data.hostelId,
      };
    }).then(async (res: any) => {
      await eventSystem.trigger("payment_recorded", {
        payment_id: res.payment.id,
        obligation_id: data.obligationId,
        tenant_id: res.payment.tenant_id,
        owner_id: res.payment.owner_id,
        hostel_id: res.payment.hostel_id,
        amount: data.amountPaid,
        method: data.paymentMethod,
      });

      if (res.payment?.tenant_id) {
        await tenantAnalyticsService.markReminderConversion(data.obligationId, data.paymentDate || new Date());
        tenantAnalyticsService.calculateTenantScore(res.payment.tenant_id).catch((e: any) =>
          logger.error("tenantScore.failed", { err: e.message })
        );
      }

      // Create ledger receipt record (no PDF/email — decommissioned for audit compliance)
      receiptService.createReceipt(res.payment.id).catch((err: any) =>
        logger.error("recordOfflinePaymentWithToken.receipt_failed", { err })
      );

      await eventLog.log("OFFLINE_PAYMENT_RECORDED", data.userId, {
        payment_id: res.payment.id,
        obligation_id: data.obligationId,
        amount: data.amountPaid,
        method: data.paymentMethod,
        jti,
        ip: data.offlineRecordedIp || null,
        note: data.offlineNote || null,
      });

      return res;
    });
  }

  async recordTenantRentPaymentWithToken(jti: string, data: {
    hostelId: string;
    tenantId: string;
    amountPaid: number;
    paymentMethod: string;
    referenceNumber?: string;
    paymentDate?: Date;
    userId: string;
    ownerId?: string;
    offlineRecordedBy: string;
    offlineRecordedAt: Date;
    offlineRecordedIp?: string;
    offlineNote?: string;
    idempotencyKey?: string;
    allowedObligationIds?: string[];
  }) {
    const groupId = data.idempotencyKey || crypto.randomUUID();
    const res = await prisma.$transaction(async (tx: any) => {
      await consumeIdentityTokenInTx(tx, jti);
      return this._settleTenantRentPaymentInTx(tx, data, groupId);
    });

    for (const alloc of res.allocations) {
      await eventSystem.trigger("payment_recorded", {
        payment_id: alloc.payment_id,
        obligation_id: alloc.obligation_id,
        tenant_id: data.tenantId,
        owner_id: alloc.owner_id,
        hostel_id: data.hostelId,
        amount: alloc.allocated,
        method: data.paymentMethod,
        group_id: res.groupId,
      });
    }

    const firstPaymentId = res.allocations[0]?.payment_id;
    if (firstPaymentId) {
      receiptService.createReceipt(firstPaymentId).catch((err: any) =>
        logger.error("recordTenantRentPaymentWithToken.receipt_failed", { err })
      );
    }

    await eventLog.log("OFFLINE_TENANT_RENT_PAYMENT_RECORDED", data.userId, {
      tenant_id: data.tenantId,
      payment_group_id: res.groupId,
      amount: data.amountPaid,
      method: data.paymentMethod,
      future_credit: 0, // ADR-036: retained field, always zero
      jti,
      ip: data.offlineRecordedIp || null,
      note: data.offlineNote || null,
    });

    return res;
  }

  async recordPayment(data: {
    hostelId: string;
    obligationId: string;
    amountPaid: number;
    paymentMethod: string;
    referenceNumber?: string;
    paymentDate?: Date;
    userId?: string;
    ownerId?: string;
    paymentAttemptId?: string;
    offlineRecordedBy?: string;
    offlineRecordedAt?: Date;
    offlineRecordedIp?: string;
    offlineNote?: string;
  }) {
    return prisma.$transaction(async (tx: any) => {
      const obligation = await tx.rent_obligations.findUnique({
        where: { id: data.obligationId },
        select: { tenant_id: true },
      });
      if (!obligation) throw new Error("NOT_FOUND: Obligation not found");

      const result = await financialPaymentFacade.receivePayment(tx, {
        hostelId: data.hostelId,
        tenantId: obligation.tenant_id,
        amountPaid: data.amountPaid,
        paymentMethod: data.paymentMethod,
        referenceNumber: data.referenceNumber,
        paymentDate: data.paymentDate,
        userId: data.userId,
        ownerId: data.ownerId,
        paymentAttemptId: data.paymentAttemptId,
        offlineRecordedBy: data.offlineRecordedBy,
        offlineRecordedAt: data.offlineRecordedAt,
        offlineRecordedIp: data.offlineRecordedIp,
        offlineNote: data.offlineNote,
        obligationIdFilter: [data.obligationId],
      }, data.paymentAttemptId || crypto.randomUUID());

      const allocation = result.allocations[0];
      if (!allocation) throw new Error("SETTLEMENT_FAILED: Payment produced no allocation");

      return {
        payment: {
          id: allocation.payment_id,
          obligation_id: allocation.obligation_id,
          tenant_id: obligation.tenant_id,
          owner_id: allocation.owner_id,
          hostel_id: data.hostelId,
          amount_paid: allocation.allocated,
        },
        newStatus: allocation.new_status,
        tenantId: obligation.tenant_id,
        ownerId: allocation.owner_id,
        hostelId: data.hostelId,
      };
    }).then(async (res: any) => {
      await eventSystem.trigger("payment_recorded", {
        payment_id: res.payment.id,
        obligation_id: data.obligationId,
        tenant_id: res.payment.tenant_id,
        owner_id: res.payment.owner_id,
        hostel_id: res.payment.hostel_id,
        amount: data.amountPaid,
        method: data.paymentMethod
      });

      // 📊 ANALYTICS: Track Reminder -> Payment Conversion & update score
      if (res.payment?.id && data.paymentDate) {
        await tenantAnalyticsService.markReminderConversion(data.obligationId, new Date(data.paymentDate));
      } else if (res.payment?.id) {
        await tenantAnalyticsService.markReminderConversion(data.obligationId, new Date());
      }
      
      if (res.payment?.tenant_id) {
        // Fire and forget behavior score update
        tenantAnalyticsService.calculateTenantScore(res.payment.tenant_id).catch(e => logger.error("tenantScore.failed", { err: e.message }));
      }

      // Create ledger receipt record (no PDF/email — decommissioned for audit compliance)
      receiptService.createReceipt(res.payment.id).catch(err =>
        console.error("[recordPayment] Receipt creation failed:", err)
      );

      // 🔧 FIX M3: Audit log for all payment recordings
      await eventLog.log("PAYMENT_RECORDED", data.userId || null, {
        payment_id: res.payment.id,
        obligation_id: data.obligationId,
        amount: data.amountPaid,
        method: data.paymentMethod,
      });

      return res;
    });
  }

  /**
   * 💰 FIFO Payment Allocation — Financial-Grade Implementation
   *
   * Total payable = RENT + ALL unpaid LATE_FEEs
   *
   * Safety guarantees:
   * 1. Row-level locking (FOR UPDATE) — prevents concurrent double-pay
   * 2. Idempotency key — prevents duplicate payments from retries/double-clicks
   * 3. Paisa-safe arithmetic — all math in integer cents, no floating-point
   * 4. Payment grouping — one payment_group_id per user action
   * 5. Single receipt — one receipt per group, shows full breakdown
   * 6. FIFO order — oldest due_date first, RENT before LATE_FEE within same date
   * 7. Partial payments allowed — remaining obligations stay PENDING/PARTIAL
   */
  async recordTenantPayment(data: {
    hostelId: string;
    tenantId: string;
    amountPaid: number;
    paymentMethod: string;
    referenceNumber?: string;
    paymentDate?: Date;
    userId?: string;
    paymentAttemptId?: string;
    idempotencyKey?: string;
  }) {
    const hostelId = requireFinancialHostelId(data.hostelId, "tenant payment");

    // ── 1. INPUT VALIDATION ──
    if (!data.tenantId) throw new Error("BAD_REQUEST: tenant_id is required");
    if (!data.paymentMethod) throw new Error("BAD_REQUEST: payment_method is required");
    if (!Number.isFinite(data.amountPaid) || data.amountPaid <= 0) {
      throw new Error("BAD_REQUEST: amount_paid must be a positive finite number");
    }
    if (data.amountPaid > 10_000_000) {
      throw new Error("BAD_REQUEST: amount_paid exceeds maximum allowed (₹1 crore)");
    }

    // ── 2. IDEMPOTENCY CHECK ──
    // If caller provides a key, check if this payment was already processed.
    // This prevents duplicate payments from retries, double-clicks, or network failures.
    if (data.idempotencyKey) {
      const existing = await prisma.payments.findFirst({
        where: { idempotency_key: data.idempotencyKey, hostel_id: hostelId },
        select: { payment_group_id: true, amount_paid: true, created_at: true },
      });
      if (existing) {
        logger.info("payments.record_tenant.idempotent_skip", {
          idempotency_key: data.idempotencyKey,
          payment_group_id: existing.payment_group_id,
        });
        // Return the existing group's data
        const groupPayments = await prisma.payments.findMany({
          where: { payment_group_id: existing.payment_group_id!, hostel_id: hostelId },
          include: { obligation: { select: { obligation_type: true, rent_month: true } } },
        });
        return {
          duplicate: true,
          payment_group_id: existing.payment_group_id,
          totalPaid: groupPayments.reduce((s, p) => s + Number(p.amount_paid), 0),
          payments: groupPayments.map(p => ({
            payment_id: p.id,
            obligation_id: p.obligation_id,
            obligation_type: p.obligation?.obligation_type,
            allocated: Number(p.amount_paid),
          })),
        };
      }
      // ADR-036: the credit-remainder duplicate check was removed with future
      // rent credit — no settlement writes PAYMENT_GROUP_REMAINDER any more, so
      // this lookup could only ever return legacy rows. Duplicate detection is
      // handled by the payment-group lookup above.
    }

    const groupId = crypto.randomUUID();

    // ── 3. ATOMIC TRANSACTION WITH ROW-LEVEL LOCKING + SETTLEMENT INVARIANT ──
    const txResult = await prisma.$transaction(async (tx: any) => {
      // Capture pre-settlement state for invariant validation
      const initialOutstanding = await this.getTenantOutstandingInTx(tx, data.tenantId, hostelId);
      const initialLedgerBalance = await this.getTenantLedgerBalanceInTx(tx, data.tenantId);

      const result = await this._settleTenantRentPaymentInTx(tx, data, data.idempotencyKey || groupId);

      // Settlement invariant (ADR-036): Paid = ΣAllocations exactly. There is
      // no future-credit term any more — excess is impossible because the
      // engine refuses an unallocated remainder.
      const totalAllocated = result.allocations.reduce((s: number, a: any) => s + a.allocated, 0);
      const totalSettled = totalAllocated;
      const tolerance = 0.01;

      if (Math.abs(totalSettled - data.amountPaid) > tolerance) {
        // Log anomaly before rollback
        try {
          await paymentOperationalAnomalyService.logAnomaly({
            type: "SETTLEMENT_INVARIANT_VIOLATION",
            source: "recordTenantPayment",
            severity: "CRITICAL",
            tenantId: data.tenantId,
            hostelId,
            details: {
              amount_paid: data.amountPaid,
              total_allocated: totalAllocated,
              total_settled: totalSettled,
              difference: data.amountPaid - totalSettled,
              initial_outstanding: initialOutstanding,
              initial_ledger_balance: initialLedgerBalance,
            },
          });
        } catch (anomalyErr) {
          logger.error("payments.invariant.anomaly_log_failed", { error: String(anomalyErr) });
        }

        throw new Error(
          `INVARIANT_VIOLATION: Settlement mismatch in recordTenantPayment. ` +
          `Paid: ₹${data.amountPaid}, Allocated: ₹${totalAllocated}, ` +
          `Total Settled: ₹${totalSettled}`
        );
      }

      return result;
    });

    // ── 5. POST-TRANSACTION: Events, receipt, audit log ──
    // (Outside transaction — idempotent side-effects)

    // Fire payment events
    for (const alloc of txResult.allocations) {
      await eventSystem.trigger("payment_recorded", {
        payment_id: alloc.payment_id,
        obligation_id: alloc.obligation_id,
        tenant_id: data.tenantId,
        owner_id: (alloc as any).owner_id,
        hostel_id: data.hostelId,
        amount: alloc.allocated,
        method: data.paymentMethod,
        group_id: txResult.groupId,
      });
    }

    // ONE receipt per payment group (not per allocation)
    // Uses the FIRST payment in the group as the anchor, stores full breakdown
    const firstPaymentId = txResult.allocations[0]?.payment_id;
    if (firstPaymentId) {
      receiptService.createReceipt(firstPaymentId).catch(err =>
        console.error("[recordTenantPayment] Receipt creation failed:", err)
      );
    }

    // Audit log
    await eventLog.log("TENANT_PAYMENT_RECORDED", data.userId || null, {
      tenant_id: data.tenantId,
      payment_group_id: txResult.groupId,
      total_paid: txResult.totalPaid,
      total_due: txResult.totalDue,
      allocations: txResult.allocations.map((a: any) => ({
        obligation_type: a.obligation_type,
        amount: a.allocated,
        status: a.new_status,
      })),
      future_credit: 0, // ADR-036: retained field, always zero
      method: data.paymentMethod,
      idempotency_key: data.idempotencyKey || null,
    });

    return txResult;
  }

  /**
   * 📊 Get total dues for a tenant — aggregates RENT + LATE_FEE obligations
   *
   * This is what the frontend payment page should call to show:
   *   [ ] Rent (May 2026) — ₹8,000
   *   [ ] Late Fee (Apr 2026) — ₹500
   *   [ ] Late Fee (Apr 2026) — ₹200
   *   Total: ₹8,700
   */
  async getTenantTotalDues(tenantId: string) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { owner_id: true, hostel_id: true },
    });
    if (!tenant?.hostel_id) throw new Error("HOSTEL_CONTEXT_REQUIRED: tenant hostel scope unavailable");
    return financialService.getTenantDues(tenantId, tenant.owner_id || undefined, tenant.hostel_id);
  }

  async createMultiObligationPaymentIntent(
    obligationIds: string[],
    userId: string,
    tenantId?: string,
    options: { bypassCollectionPolicy?: boolean; source?: string } = {}
  ) {
    // ── 1. INITIAL VALIDATION (outside tx — fast-path rejects, no locks needed) ──
    const obligations = await prisma.rent_obligations.findMany({
      where: { id: { in: obligationIds } },
      include: { tenants: { include: { profiles: true } } }
    });

    if (obligations.length === 0) {
      throw new Error("NOT_FOUND: No obligations found");
    }
    if (obligations.length !== obligationIds.length) {
      const foundIds = new Set(obligations.map(o => o.id));
      const missing = obligationIds.filter(id => !foundIds.has(id));
      throw new Error(`NOT_FOUND: Obligations not found: ${missing.join(", ")}`);
    }

    const tenantIds = Array.from(new Set(obligations.map(o => o.tenant_id).filter(Boolean)));
    if (tenantIds.length > 1) {
      throw new Error("BAD_REQUEST: All obligations must belong to the same tenant");
    }
    const singleTenantId = tenantIds[0];
    if (tenantId && singleTenantId !== tenantId) {
      throw new Error("FORBIDDEN: You can only pay your own obligations");
    }

    // ── Chronology enforcement: canonical validateChronology, the same rule
    // every other settlement path uses (no gaps in selected RENT obligations,
    // sorted by due_date) — replaces a second, looser, independently-hardcoded
    // FIFO rule that also omitted OVERDUE from its fetch. ──
    if (!options.bypassCollectionPolicy) {
      const allUnpaid = await prisma.rent_obligations.findMany({
        where: {
          tenant_id: singleTenantId,
          status: { in: PAYABLE_STATUSES },
          is_superseded: false,
        },
        include: { payments: { select: { amount_paid: true } } },
      });

      if (allUnpaid.length > 0) {
        const snapshots = allUnpaid.map((o: any) => toObligationSnapshot(o));
        const chronoCheck = validateChronology(snapshots, obligationIds);
        if (!chronoCheck.valid) {
          throw new Error(`BAD_REQUEST: ${chronoCheck.reason || "Chronological rent rule violation"}`);
        }
      }
    }

    // V2: Use canonical isPayable() from settlement-planner (single source of truth for payability)
    const nonPayable = obligations.filter(o => !isPayable(o));
    if (nonPayable.length > 0) {
      const details = nonPayable.map(o => `${o.id} (${o.status})`).join(", ");
      throw new Error(`BAD_REQUEST: Some obligations cannot accept payments: ${details}`);
    }

    const hostelIds = Array.from(new Set(obligations.map(o => o.hostel_id).filter(Boolean)));
    if (hostelIds.length !== 1) {
      throw new Error("HOSTEL_CONTEXT_MISMATCH: All selected obligations must belong to exactly one hostel");
    }
    const hostelId = requireFinancialHostelId(hostelIds[0], "multi-obligation payment intent");
    for (const obligation of obligations) {
      assertScopedEntityHostel("rent obligation", obligation, hostelId);
      assertSameFinancialHostel("tenant", (obligation as any).tenants, "rent obligation", obligation);
    }

    const ownerId = obligations[0].owner_id || "";
    // Resolve from the first obligation's immutable hostel chain.
    const { prefs } = await getObligationOperationalContext(obligations[0]);
    const providerContext = await getProviderContext({
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flowType: PAYMENT_FLOW.RENT,
      operationalOwnerId: ownerId,
      financialOwnerId: ownerId,
      hostelId,
      scopeType: PAYMENT_SCOPE.HOSTEL,
    });
    const { provider, config } = providerContext;
    const instance = PaymentProviderFactory.getProvider(provider, config);

    // ── 2. PAYMENT RULES — validate via canonical settlement planner ──
    // V3: Replaces count-based "select ALL" enforcement with amount-based tier validation.
    // This correctly allows paying a full tier without requiring every obligation to be selected.
    if (!options.bypassCollectionPolicy) {
      // Build snapshots from the selected obligations for planner validation
      const selectedSnapshots = obligations
        .filter(o => o.status !== "PAID" && o.status !== "WAIVED")
        .map(ob => {
          const paidAmount = (ob as any).payments
            ? (ob as any).payments.reduce((s: number, p: any) => s + Number(p.amount_paid), 0)
            : 0;
          return {
            id: ob.id,
            obligation_type: ob.obligation_type,
            amount: Number(ob.amount),
            paid: paidAmount,
            due_date: new Date(ob.due_date),
            rent_month: ob.rent_month ? new Date(ob.rent_month) : null,
            owner_id: ob.owner_id || "",
          };
        });
      const selectedTotal = selectedSnapshots.reduce((s, snap) =>
        s + Math.max(snap.amount - snap.paid, 0), 0);
      if (selectedTotal > 0) {
        const preflightPlan = buildSettlementPlan(selectedSnapshots, selectedTotal, {
          allow_partial: prefs.allow_partial_payments,
          minimum_amount: prefs.min_payment_amount,
        });
        if (!preflightPlan.payment_accepted) {
          throw new Error(`BAD_REQUEST: ${preflightPlan.rejection_reason}`);
        }
      }
    }

    // ── 3. ATOMIC TRANSACTION: lock → re-read amounts → dedup → create attempt ──
    //
    // Two-level serialization:
    //   a) pg_advisory_xact_lock — tenant-scoped mutex. Prevents concurrent
    //      create-intent calls for the SAME TENANT even when they select
    //      non-overlapping obligation sets (which FOR UPDATE alone cannot stop).
    //   b) SELECT ... FOR UPDATE — obligation-row lock. Belt-and-suspenders for
    //      requests on the same obligation set that somehow bypass advisory lock.
    //
    // Both locks release automatically when this transaction commits or rolls back.
    // Gateway I/O happens OUTSIDE this transaction so locks are not held during
    // network delay.
    const txResult = await prisma.$transaction(async (tx) => {
      // Advisory lock: tenant-scoped, so two simultaneous create-intents for the
      // same tenant block here regardless of which obligations they select.
      // hashtext() maps the UUID string to int4; cast to bigint for the lock API.
      const advisoryKey = `pay_intent:${singleTenantId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey})::bigint)`;

      // Row-level lock on selected obligations — complements advisory lock and
      // protects re-read amounts from concurrent finalization.
      await tx.$queryRaw`
        SELECT id FROM rent_obligations
        WHERE id = ANY(${obligationIds}::uuid[])
          AND hostel_id = ${hostelId}::uuid
        FOR UPDATE
      `;

      // Re-read with fresh payments under lock — source of truth for amounts
      const locked = await tx.rent_obligations.findMany({
        where: { id: { in: obligationIds }, hostel_id: hostelId },
        include: { payments: { select: { amount_paid: true, hostel_id: true } } }
      });

      if (locked.length !== obligationIds.length) {
        throw new Error("HOSTEL_CONTEXT_MISMATCH: Selected obligations changed hostel scope during payment intent creation");
      }
      for (const ob of locked) {
        assertScopedEntityHostel("locked rent obligation", ob, hostelId);
        for (const payment of ob.payments) {
          assertSameFinancialHostel("existing payment", payment, "rent obligation", ob);
        }
      }

      let totalAmountPaisa = 0;
      const paymentBreakdown: { obligationId: string; amount: number }[] = [];

      for (const ob of locked) {
        if (ob.status === "PAID" || ob.status === "WAIVED") continue;
        const paidPaisa = ob.payments.reduce((sum, p) => sum + Math.round(Number(p.amount_paid) * 100), 0);
        const duePaisa = Math.round(Number(ob.amount) * 100);
        const outstandingPaisa = Math.max(0, duePaisa - paidPaisa);
        if (outstandingPaisa <= 0) continue;
        totalAmountPaisa += outstandingPaisa;
        paymentBreakdown.push({ obligationId: ob.id, amount: outstandingPaisa / 100 });
      }

      if (totalAmountPaisa <= 0) {
        throw new Error("BAD_REQUEST: No outstanding amount to pay (verified under lock)");
      }

      const totalAmount = totalAmountPaisa / 100;
      const minAmountPaisa = Math.round(prefs.min_payment_amount * 100);
      if (!options.bypassCollectionPolicy && totalAmountPaisa < minAmountPaisa) {
        throw new Error(`BAD_REQUEST: Minimum payment amount allowed is ${formatCurrency(prefs.min_payment_amount)}`);
      }

      // Dedup check inside the same tx — eliminates TOCTOU race
      const existingLinks = await tx.payment_attempt_obligations.findMany({
        where: {
          obligation_id: { in: paymentBreakdown.map(p => p.obligationId) },
          payment_attempts: { hostel_id: hostelId, status: { in: ["CREATED", "PENDING"] } },
        },
        include: { payment_attempts: true },
        orderBy: { created_at: "desc" },
      });

      if (existingLinks.length > 0) {
        const existingAttempt = existingLinks[0].payment_attempts;
        const checkoutUrl = existingAttempt.checkout_url || "";
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);

        // An in-flight CREATED attempt has no checkout_url yet because the gateway
        // call is still running (we are outside the tx when we call PhonePe).
        // Do NOT expire it — return it and let the caller wait for the checkout_url.
        const isInFlight =
          existingAttempt.status === "CREATED" &&
          existingAttempt.created_at > twoMinAgo;

        // A live PENDING attempt already has a usable checkout URL.
        const isSandboxCheckout = ["mercury-t2", "api-preprod", "pg-sandbox"].some(m => checkoutUrl.includes(m));
        if (isSandboxCheckout) {
          logger.warn("payments.create_multi_intent.expire_sandbox_attempt", {
            attemptId: existingAttempt.id,
            checkoutUrl,
            reason: "sandbox checkout URL rejected in production — expiring",
          });
        }
        const hasValidCheckout =
          checkoutUrl.length > 0 && !checkoutUrl.includes("/payment-return") && !isSandboxCheckout;

        if (isInFlight || hasValidCheckout) {
          logger.info("payments.create_multi_intent.reuse_existing", {
            existingAttemptId: existingAttempt.id,
            merchantTxnId: existingAttempt.merchant_txn_id,
            reason: isInFlight ? "in_flight_created" : "valid_checkout",
          });
          return { attempt: this.mapAttemptWithRawResponse(existingAttempt), isReused: true as const, totalAmount, paymentBreakdown };
        }

        // Stale: CREATED > 2 min with no checkout_url, or PENDING with expired URL
        await this.updateAttemptStatus(tx, {
          attemptId: existingAttempt.id,
          fromStatus: existingAttempt.status,
          toStatus: "EXPIRED",
          source: "CREATE_INTENT",
          reason: "stale multi-obligation checkout attempt expired before replacement",
          operationalOwnerId: existingAttempt.owner_id,
          financialOwnerId: existingAttempt.owner_id,
          hostelId: existingAttempt.hostel_id,
          data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
        });
      }

      const merchantTxnId = `hms_multi_${crypto.randomBytes(6).toString("hex")}`;

      logger.info("payments.create_multi_intent.start", {
        obligationCount: obligationIds.length,
        userId,
        tenantId: tenantId || null,
        provider,
        amount: totalAmount,
        merchantTxnId,
        breakdown: paymentBreakdown,
      });

      const newAttempt = await tx.paymentAttempt.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: singleTenantId,
          owner_id: ownerId,
          provider,
          merchant_txn_id: merchantTxnId,
          merchant_transaction_id: merchantTxnId,
          amount: totalAmount,
          status: "CREATED",
          hostel_id: hostelId,
          payment_domain: providerContext.payment_domain,
          scope_type: providerContext.scope_type,
          flow_type: providerContext.flow_type,
          merchant_context_type: providerContext.merchant_context_type,
          merchant_context_id: providerContext.merchant_context_id,
          settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
          raw_create_response: options.source ? { source: options.source, bypass_collection_policy: Boolean(options.bypassCollectionPolicy) } : undefined,
        }
      });
      await paymentStatusEventService.append(tx, {
        attemptId: newAttempt.id,
        fromStatus: null,
        toStatus: "CREATED",
        source: "CREATE_INTENT",
        reason: "rent multi-obligation attempt created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
      });

      await tx.payment_attempt_obligations.createMany({
        data: paymentBreakdown.map(item => ({
          id: crypto.randomUUID(),
          payment_attempt_id: newAttempt.id,
          obligation_id: item.obligationId,
          amount: item.amount,
        }))
      });

      return { attempt: newAttempt, isReused: false as const, totalAmount, paymentBreakdown };
    });

    if (txResult.isReused) return txResult.attempt;

    const { attempt, totalAmount } = txResult;

    // ── 4. CALL GATEWAY (outside transaction — network I/O must not hold a DB lock) ──
    try {
      const result = await instance.createIntent({
        amount: totalAmount,
        merchant_txn_id: attempt.merchant_txn_id,
        tenant_name: (obligations[0] as any).tenants?.profiles?.name || "Tenant",
        tenant_email: (obligations[0] as any).tenants?.profiles?.email || "",
        tenant_phone: (obligations[0] as any).tenants?.profiles?.phone || "",
        metadata: {
          obligation_ids: obligationIds,
          tenant_id: singleTenantId,
          attempt_id: attempt.id,
          is_multi: true
        }
      });

      return await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "PENDING",
        source: "CREATE_INTENT",
        reason: "provider checkout created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: {
          gateway_txn_id: result.gateway_txn_id,
          ...this.attemptIdentityData(attempt.merchant_txn_id, result),
          upi_intent_url: result.upi_intent_url,
          qr_payload: result.qr_payload,
          checkout_url: result.checkout_url,
          expires_at: result.expires_at,
          raw_create_response: result.raw_response as any
        }
      });
    } catch (error) {
      logger.error("payments.create_multi_intent.failed", {
        attemptId: attempt.id,
        provider,
        merchantTxnId: attempt.merchant_txn_id,
        error: String(error),
      });
      await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "FAILED",
        source: "CREATE_INTENT",
        reason: "provider checkout creation failed",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: { raw_create_response: { error: String(error) } as any, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE }
      });
      throw error;
    }
  }

  /**
   * Amount-first counterpart to createMultiObligationPaymentIntent: instead of
   * a pre-picked obligation list, the caller supplies a raw rupee amount. The
   * FIFO settlement plan (same engine the offline "Receive Payment" flow uses)
   * decides which obligations absorb it and how much of each; any remainder
   * becomes future rent credit at finalization — no obligations required.
   */
  async createAmountPaymentIntent(
    amountRupees: number,
    ownerId: string,
    tenantId: string,
    hostelId: string,
    options: { bypassCollectionPolicy?: boolean; source?: string } = {}
  ) {
    if (!(amountRupees > 0)) {
      throw new Error("BAD_REQUEST: Amount must be greater than zero");
    }

    const hostelIdSafe = requireFinancialHostelId(hostelId, "amount-based payment intent");

    const providerContext = await getProviderContext({
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flowType: PAYMENT_FLOW.RENT,
      operationalOwnerId: ownerId,
      financialOwnerId: ownerId,
      hostelId: hostelIdSafe,
      scopeType: PAYMENT_SCOPE.HOSTEL,
    });
    const { provider, config } = providerContext;
    const instance = PaymentProviderFactory.getProvider(provider, config);

    const txResult = await prisma.$transaction(async (tx) => {
      // Same tenant-scoped advisory lock createMultiObligationPaymentIntent uses,
      // so the two intent-creation paths mutually exclude each other for one tenant.
      const advisoryKey = `pay_intent:${tenantId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${advisoryKey})::bigint)`;

      await tx.$queryRaw`
        SELECT id FROM rent_obligations
        WHERE tenant_id = ${tenantId}::uuid
          AND hostel_id = ${hostelIdSafe}::uuid
          AND status::text = ANY(ARRAY['OVERDUE','PENDING','PARTIAL','UPCOMING']::text[])
          AND is_superseded = false
        FOR UPDATE
      `;

      const obligationWhere = {
        tenant_id: tenantId,
        hostel_id: hostelIdSafe,
        status: { in: PAYABLE_STATUSES },
        is_superseded: false,
      };

      let obligations = await tx.rent_obligations.findMany({
        where: obligationWhere,
        include: { payments: { select: { amount_paid: true } } },
      });

      let snapshots = obligations.map((ob: any) => toObligationSnapshot(ob));

      // ADR-036: every rupee must land on a real installment — there is no
      // future-rent-credit balance to absorb an overpayment. If the tenant is
      // paying ahead, generate their next installment(s) from the agreement
      // first, then re-read so the planner can allocate across them.
      const outstandingTotal = snapshots.reduce(
        (sum: number, ob: any) => sum + Math.max(Number(ob.amount) - Number(ob.paid), 0),
        0,
      );
      if (amountRupees > outstandingTotal) {
        const shortfall = amountRupees - outstandingTotal;
        const generated = await rentGenerationService.ensureInstallmentsForTenant({
          tenantId,
          ownerId,
          hostelId: hostelIdSafe,
          amountNeeded: shortfall,
          tx,
        });

        if (generated.exhausted) {
          throw new Error(
            `BAD_REQUEST: Cannot accept ₹${amountRupees} — only ₹${outstandingTotal + generated.coveredAmount} of installments exist for this tenant`,
          );
        }

        obligations = await tx.rent_obligations.findMany({
          where: obligationWhere,
          include: { payments: { select: { amount_paid: true } } },
        });
        snapshots = obligations.map((ob: any) => toObligationSnapshot(ob));
      }

      const hostelRecord = await tx.hostels.findUnique({
        where: { id: hostelIdSafe },
        select: { preferences_config: true },
      });
      const paymentPolicy = financialPolicyEngine.resolvePaymentPolicy(hostelRecord);

      const plan = buildSettlementPlan(snapshots, amountRupees, paymentPolicy);

      if (!plan.payment_accepted && !options.bypassCollectionPolicy) {
        throw new Error(`BAD_REQUEST: ${plan.rejection_reason}`);
      }

      const obligationsToLink = plan.allocations.filter((a) => a.allocated > 0);

      // Dedup against an in-flight/valid attempt already covering the same
      // obligations — mirrors createMultiObligationPaymentIntent. Only
      // meaningful when there's a real obligation set to check against; the
      // pure-future-credit case (no obligations) skips this check.
      if (obligationsToLink.length > 0) {
        const existingLinks = await tx.payment_attempt_obligations.findMany({
          where: {
            obligation_id: { in: obligationsToLink.map((a) => a.obligation_id) },
            payment_attempts: { hostel_id: hostelIdSafe, status: { in: ["CREATED", "PENDING"] } },
          },
          include: { payment_attempts: true },
          orderBy: { created_at: "desc" },
        });

        if (existingLinks.length > 0) {
          const existingAttempt = existingLinks[0].payment_attempts;
          const checkoutUrl = existingAttempt.checkout_url || "";
          const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
          const isInFlight = existingAttempt.status === "CREATED" && existingAttempt.created_at > twoMinAgo;
          const isSandboxCheckout = ["mercury-t2", "api-preprod", "pg-sandbox"].some((m) => checkoutUrl.includes(m));
          const hasValidCheckout = checkoutUrl.length > 0 && !checkoutUrl.includes("/payment-return") && !isSandboxCheckout;

          if (isInFlight || hasValidCheckout) {
            return { attempt: this.mapAttemptWithRawResponse(existingAttempt), isReused: true as const };
          }

          await this.updateAttemptStatus(tx, {
            attemptId: existingAttempt.id,
            fromStatus: existingAttempt.status,
            toStatus: "EXPIRED",
            source: "CREATE_INTENT",
            reason: "stale amount-based checkout attempt expired before replacement",
            operationalOwnerId: existingAttempt.owner_id,
            financialOwnerId: existingAttempt.owner_id,
            hostelId: existingAttempt.hostel_id,
            data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
          });
        }
      }

      const merchantTxnId = `hms_amt_${crypto.randomBytes(6).toString("hex")}`;

      const newAttempt = await tx.paymentAttempt.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          owner_id: ownerId,
          provider,
          merchant_txn_id: merchantTxnId,
          merchant_transaction_id: merchantTxnId,
          amount: amountRupees,
          status: "CREATED",
          hostel_id: hostelIdSafe,
          payment_domain: providerContext.payment_domain,
          scope_type: providerContext.scope_type,
          flow_type: providerContext.flow_type,
          merchant_context_type: providerContext.merchant_context_type,
          merchant_context_id: providerContext.merchant_context_id,
          settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
          raw_create_response: {
            source: options.source,
            bypass_collection_policy: Boolean(options.bypassCollectionPolicy),
            // Persisted even when non-empty (harmless/ignored once
            // payment_attempt_obligations rows exist) — but REQUIRED to be a
            // real empty array (not omitted) when obligationsToLink is empty,
            // so finalizePaymentAttempt's fallback branch routes the full
            // amount to future credit instead of re-sweeping all outstanding
            // obligations. See payment-service.ts's `allowedIds` handling in
            // finalizePaymentAttempt's `else if (attempt.tenant_id)` branch.
            allowed_obligation_ids: obligationsToLink.map((a) => a.obligation_id),
          },
        },
      });

      await paymentStatusEventService.append(tx, {
        attemptId: newAttempt.id,
        fromStatus: null,
        toStatus: "CREATED",
        source: "CREATE_INTENT",
        reason: "amount-based payment attempt created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId: hostelIdSafe,
      });

      if (obligationsToLink.length > 0) {
        await tx.payment_attempt_obligations.createMany({
          data: obligationsToLink.map((a) => ({
            id: crypto.randomUUID(),
            payment_attempt_id: newAttempt.id,
            obligation_id: a.obligation_id,
            amount: a.allocated,
          })),
        });
      }

      return {
        attempt: newAttempt,
        isReused: false as const,
        allowedObligationIds: obligationsToLink.map((a) => a.obligation_id),
      };
    });

    if (txResult.isReused) return txResult.attempt;

    const { attempt, allowedObligationIds } = txResult;

    const tenantRecord = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: { profiles: true },
    });

    try {
      const result = await instance.createIntent({
        amount: amountRupees,
        merchant_txn_id: attempt.merchant_txn_id,
        tenant_name: (tenantRecord as any)?.profiles?.name || "Tenant",
        tenant_email: (tenantRecord as any)?.profiles?.email || "",
        tenant_phone: (tenantRecord as any)?.profiles?.phone || "",
        metadata: {
          tenant_id: tenantId,
          attempt_id: attempt.id,
          is_amount_based: true,
        },
      });

      return await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "PENDING",
        source: "CREATE_INTENT",
        reason: "provider checkout created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId: hostelIdSafe,
        data: {
          gateway_txn_id: result.gateway_txn_id,
          ...this.attemptIdentityData(attempt.merchant_txn_id, result),
          upi_intent_url: result.upi_intent_url,
          qr_payload: result.qr_payload,
          checkout_url: result.checkout_url,
          expires_at: result.expires_at,
          // Preserve allowed_obligation_ids across this overwrite — raw_create_response
          // is a full replace (not a JSON merge), and finalizePaymentAttempt's tenant-fallback
          // branch (the `else if (attempt.tenant_id)` case) reads allowed_obligation_ids from
          // this same field to decide whether to sweep all outstanding obligations or restrict
          // to (possibly zero) linked ones. Losing it here would silently widen a pure-future-credit
          // intent into a full FIFO sweep at finalization time.
          raw_create_response: {
            ...(result.raw_response as any),
            allowed_obligation_ids: allowedObligationIds,
          },
        },
      });
    } catch (error) {
      logger.error("payments.create_amount_intent.failed", {
        attemptId: attempt.id,
        provider,
        merchantTxnId: attempt.merchant_txn_id,
        error: String(error),
      });
      await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "FAILED",
        source: "CREATE_INTENT",
        reason: "provider checkout creation failed",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId: hostelIdSafe,
        data: { raw_create_response: { error: String(error) } as any, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
      });
      throw error;
    }
  }

  async createTenantRentPaymentIntent(params: {
    tenantId: string;
    ownerId: string;
    amount: number;
    profileId: string;
    allowedObligationIds?: string[];
  }) {
    const { tenantId, ownerId, amount, profileId, allowedObligationIds } = params;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("BAD_REQUEST: Amount must be positive");
    }

    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: { profiles: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: Tenant does not belong to this owner");

    const hostelId = requireFinancialHostelId(tenant.hostel_id, "tenant rent payment intent");
    // V2: No rent-floor enforcement. HMS has non-rent obligations (maintenance,
    // deposits, extra charges) that are legitimately below monthly rent.
    // Minimum is enforced by hostel prefs.min_payment_amount at the gateway level.

    const providerContext = await getProviderContext({
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flowType: PAYMENT_FLOW.RENT,
      operationalOwnerId: ownerId,
      financialOwnerId: ownerId,
      hostelId,
      scopeType: PAYMENT_SCOPE.HOSTEL,
    });
    const { provider, config } = providerContext;
    const instance = PaymentProviderFactory.getProvider(provider, config);

    const txResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"rent_intent:" + tenantId})::bigint)`;
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;

      const existing = await tx.paymentAttempt.findFirst({
        where: {
          tenant_id: tenantId,
          flow_type: PAYMENT_FLOW.RENT,
          status: { in: ["CREATED", "PENDING"] },
          obligations: { none: {} },
        },
        orderBy: { created_at: "desc" },
      });
      if (existing) {
        const checkoutUrl = existing.checkout_url || "";
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const isInFlight = existing.status === "CREATED" && existing.created_at > twoMinAgo;
        const hasValidCheckout = checkoutUrl.length > 0 && !checkoutUrl.includes("/payment-return");

        const existingAllowed = (existing.raw_create_response as any)?.allowed_obligation_ids;
        const arraysEqual = (a: any, b: any) => {
          if (!a && !b) return true;
          if (!a || !b) return false;
          if (a.length !== b.length) return false;
          return a.every((v: any) => b.includes(v));
        };
        const isSameAmount = existing.amount === amount;

        if ((isInFlight || hasValidCheckout) && isSameAmount && arraysEqual(existingAllowed, allowedObligationIds)) {
          return { attempt: this.mapAttemptWithRawResponse(existing), isReused: true as const };
        }
        await this.updateAttemptStatus(tx, {
          attemptId: existing.id,
          fromStatus: existing.status,
          toStatus: "EXPIRED",
          source: "CREATE_INTENT",
          reason: "stale tenant rent checkout attempt expired before replacement",
          operationalOwnerId: ownerId,
          financialOwnerId: ownerId,
          hostelId,
          data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
        });
      }

      const merchantTxnId = `hms_rent_${crypto.randomBytes(6).toString("hex")}`;
      const newAttempt = await tx.paymentAttempt.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          owner_id: ownerId,
          provider,
          merchant_txn_id: merchantTxnId,
          merchant_transaction_id: merchantTxnId,
          amount,
          status: "CREATED",
          payment_type: "RENT",
          hostel_id: hostelId,
          payment_domain: providerContext.payment_domain,
          scope_type: providerContext.scope_type,
          flow_type: providerContext.flow_type,
          merchant_context_type: providerContext.merchant_context_type,
          merchant_context_id: providerContext.merchant_context_id,
          settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
          raw_create_response: {
            source: "tenant_rent_custom_amount",
            profile_id: profileId,
            allowed_obligation_ids: allowedObligationIds,
          },
        } as any,
      });
      await paymentStatusEventService.append(tx, {
        attemptId: newAttempt.id,
        fromStatus: null,
        toStatus: "CREATED",
        source: "CREATE_INTENT",
        reason: "tenant rent payment attempt created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
      });
      return { attempt: newAttempt, isReused: false as const };
    });

    if (txResult.isReused) return txResult.attempt;
    const { attempt } = txResult;

    try {
      const result = await instance.createIntent({
        amount,
        merchant_txn_id: attempt.merchant_txn_id,
        tenant_name: tenant.profiles?.name || "Tenant",
        tenant_email: tenant.profiles?.email || "",
        tenant_phone: tenant.profiles?.phone || "",
        metadata: { tenant_id: tenantId, attempt_id: attempt.id, payment_type: "RENT" },
      });

      return await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "PENDING",
        source: "CREATE_INTENT",
        reason: "provider checkout created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: {
          gateway_txn_id: result.gateway_txn_id,
          ...this.attemptIdentityData(attempt.merchant_txn_id, result),
          upi_intent_url: result.upi_intent_url,
          qr_payload: result.qr_payload,
          checkout_url: result.checkout_url,
          expires_at: result.expires_at,
          raw_create_response: result.raw_response as any,
        },
      });
    } catch (error) {
      await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "FAILED",
        source: "CREATE_INTENT",
        reason: "provider checkout creation failed",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: { raw_create_response: { error: String(error) } as any, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
      });
      throw error;
    }
  }

  /**
   * Create a PhonePe payment intent for a future rent/advance payment.
   * No obligation is linked — on SUCCESS, finalizePaymentAttempt credits the ledger.
   *
   * Lock ordering (consistent with adjustAgainstObligation):
   *   pg_advisory_xact_lock(tenant) → tenant row FOR UPDATE
   */
  async createAdvancePaymentIntent(params: {
    tenantId: string;
    ownerId: string;
    amount: number;
    profileId: string;
  }) {
    const { tenantId, ownerId, amount, profileId } = params;

    if (amount <= 0) throw new Error("BAD_REQUEST: Amount must be positive");

    // Resolve prefs from the tenant's explicit hostel context.
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: { profiles: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: Tenant does not belong to this owner");

    const { prefs } = await getTenantOperationalContext(tenant.id, ownerId, tenant.hostel_id);
    const hostelId = requireFinancialHostelId(tenant.hostel_id, "advance payment intent");

    if (!prefs.advance_enabled) {
      throw new Error("BAD_REQUEST: Advance/deposit payments are not enabled for this hostel");
    }
    const minPaisa = Math.round(prefs.min_payment_amount * 100);
    const amountPaisa = Math.round(amount * 100);
    if (amountPaisa < minPaisa) {
      throw new Error(`BAD_REQUEST: Minimum payment amount is ${formatCurrency(prefs.min_payment_amount)}`);
    }

    const providerContext = await getProviderContext({
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flowType: PAYMENT_FLOW.FUTURE_RENT_CREDIT,
      operationalOwnerId: ownerId,
      financialOwnerId: ownerId,
      hostelId,
      scopeType: PAYMENT_SCOPE.HOSTEL,
    });
    const { provider, config } = providerContext;
    const instance = PaymentProviderFactory.getProvider(provider, config);

    const txResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"adv_intent:" + tenantId})::bigint)`;
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;

      // Dedup: reuse a live PENDING advance attempt for this tenant
      const existing = await tx.paymentAttempt.findFirst({
        where: {
          tenant_id: tenantId,
          payment_type: { in: ["FUTURE_RENT_CREDIT", "ADVANCE"] },
          status: { in: ["CREATED", "PENDING"] },
        },
        orderBy: { created_at: "desc" },
      });

      if (existing) {
        const checkoutUrl = (existing as any).checkout_url || "";
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const isInFlight = existing.status === "CREATED" && existing.created_at > twoMinAgo;
        const hasValidCheckout = checkoutUrl.length > 0 && !checkoutUrl.includes("/payment-return");
        if (isInFlight || hasValidCheckout) {
          return { attempt: this.mapAttemptWithRawResponse(existing), isReused: true };
        }
        await this.updateAttemptStatus(tx, {
          attemptId: existing.id,
          fromStatus: existing.status,
          toStatus: "EXPIRED",
          source: "CREATE_INTENT",
          reason: "stale advance checkout attempt expired before replacement",
          operationalOwnerId: existing.owner_id,
          financialOwnerId: existing.owner_id,
          hostelId: existing.hostel_id,
          data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
        });
      }

      const merchantTxnId = `hms_adv_${crypto.randomBytes(6).toString("hex")}`;
      const newAttempt = await tx.paymentAttempt.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          owner_id: ownerId,
          provider,
          merchant_txn_id: merchantTxnId,
          merchant_transaction_id: merchantTxnId,
          amount,
          status: "CREATED",
          payment_type: "FUTURE_RENT_CREDIT",
          hostel_id: hostelId,
          payment_domain: providerContext.payment_domain,
          scope_type: providerContext.scope_type,
          flow_type: providerContext.flow_type,
          merchant_context_type: providerContext.merchant_context_type,
          merchant_context_id: providerContext.merchant_context_id,
          settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
        } as any,
      });
      await paymentStatusEventService.append(tx, {
        attemptId: newAttempt.id,
        fromStatus: null,
        toStatus: "CREATED",
        source: "CREATE_INTENT",
        reason: "advance payment attempt created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
      });
      return { attempt: newAttempt, isReused: false };
    });

    if (txResult.isReused) return txResult.attempt;

    const { attempt } = txResult;
    try {
      const result = await instance.createIntent({
        amount,
        merchant_txn_id: attempt.merchant_txn_id,
        tenant_name: tenant.profiles.name,
        tenant_email: tenant.profiles.email,
        tenant_phone: tenant.profiles.phone || "",
        metadata: { tenant_id: tenantId, attempt_id: attempt.id, payment_type: "ADVANCE" },
      });
      return await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "PENDING",
        source: "CREATE_INTENT",
        reason: "provider checkout created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: {
          gateway_txn_id: result.gateway_txn_id,
          ...this.attemptIdentityData(attempt.merchant_txn_id, result),
          upi_intent_url: result.upi_intent_url,
          qr_payload: result.qr_payload,
          checkout_url: result.checkout_url,
          expires_at: result.expires_at,
          raw_create_response: result.raw_response as any,
        },
      });
    } catch (error) {
      await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "FAILED",
        source: "CREATE_INTENT",
        reason: "provider checkout creation failed",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: { raw_create_response: { error: String(error) } as any, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
      });
      throw error;
    }
  }

  /**
   * Create a PhonePe payment intent for onboarding security deposit.
   * On SUCCESS, finalizePaymentAttempt credits tenant_advance_ledger as DEPOSIT.
   */
  async createDepositPaymentIntent(params: {
    tenantId: string;
    ownerId: string;
    amount?: number;
    profileId: string;
  }) {
    const { tenantId, ownerId } = params;
    const requestedAmount = params.amount === undefined ? undefined : Number(params.amount);
    if (requestedAmount !== undefined && requestedAmount <= 0) {
      throw new Error("BAD_REQUEST: Amount must be positive");
    }

    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: { profiles: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: Tenant does not belong to this owner");

    const status = await activationFinancialStatusService.getActivationFinancialStatus(tenantId);
    const outstandingDeposit = Number(status.depositOutstanding || 0);
    if (outstandingDeposit <= 0) {
      throw new Error("BAD_REQUEST: Security deposit is already cleared");
    }
    const amount = requestedAmount === undefined ? outstandingDeposit : requestedAmount;
    const outstandingPaisa = Math.round(outstandingDeposit * 100);
    const amountPaisa = Math.round(amount * 100);
    if (amountPaisa > outstandingPaisa + 1) {
      throw new Error(
        `BAD_REQUEST: DEPOSIT_AMOUNT_EXCEEDS_OUTSTANDING: Payment (${formatCurrency(amount)}) exceeds security deposit due (${formatCurrency(outstandingDeposit)}).`
      );
    }

    const { prefs } = await getTenantOperationalContext(tenant.id, ownerId, tenant.hostel_id);
    const hostelId = requireFinancialHostelId(tenant.hostel_id, "deposit payment intent");

    if (!prefs.advance_enabled) {
      throw new Error("BAD_REQUEST: Advance/deposit payments are not enabled for this hostel");
    }
    const minPaisa = Math.round(prefs.min_payment_amount * 100);
    if (amountPaisa < minPaisa) {
      throw new Error(`BAD_REQUEST: Minimum payment amount is ${formatCurrency(prefs.min_payment_amount)}`);
    }

    const providerContext = await getProviderContext({
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flowType: PAYMENT_FLOW.SECURITY_DEPOSIT,
      operationalOwnerId: ownerId,
      financialOwnerId: ownerId,
      hostelId,
      scopeType: PAYMENT_SCOPE.HOSTEL,
    });
    const { provider, config } = providerContext;
    const instance = PaymentProviderFactory.getProvider(provider, config);

    const txResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dep_intent:" + tenantId})::bigint)`;
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;

      const existing = await tx.paymentAttempt.findFirst({
        where: {
          tenant_id: tenantId,
          payment_type: { in: ["SECURITY_DEPOSIT", "DEPOSIT"] },
          status: { in: ["CREATED", "PENDING"] },
        },
        orderBy: { created_at: "desc" },
      });

      if (existing) {
        const checkoutUrl = (existing as any).checkout_url || "";
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        const isInFlight = existing.status === "CREATED" && existing.created_at > twoMinAgo;
        const hasValidCheckout = checkoutUrl.length > 0 && !checkoutUrl.includes("/payment-return");
        if (isInFlight || hasValidCheckout) {
          return { attempt: this.mapAttemptWithRawResponse(existing), isReused: true };
        }
        await this.updateAttemptStatus(tx, {
          attemptId: existing.id,
          fromStatus: existing.status,
          toStatus: "EXPIRED",
          source: "CREATE_INTENT",
          reason: "stale deposit checkout attempt expired before replacement",
          operationalOwnerId: existing.owner_id,
          financialOwnerId: existing.owner_id,
          hostelId: existing.hostel_id,
          data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
        });
      }

      const merchantTxnId = `hms_dep_${crypto.randomBytes(6).toString("hex")}`;
      const newAttempt = await tx.paymentAttempt.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          owner_id: ownerId,
          provider,
          merchant_txn_id: merchantTxnId,
          merchant_transaction_id: merchantTxnId,
          amount,
          status: "CREATED",
          payment_type: "SECURITY_DEPOSIT",
          hostel_id: hostelId,
          payment_domain: providerContext.payment_domain,
          scope_type: providerContext.scope_type,
          flow_type: providerContext.flow_type,
          merchant_context_type: providerContext.merchant_context_type,
          merchant_context_id: providerContext.merchant_context_id,
          settlement_status: SETTLEMENT_STATUS.NOT_SETTLED,
        } as any,
      });
      await paymentStatusEventService.append(tx, {
        attemptId: newAttempt.id,
        fromStatus: null,
        toStatus: "CREATED",
        source: "CREATE_INTENT",
        reason: "deposit payment attempt created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
      });
      return { attempt: newAttempt, isReused: false };
    });

    if (txResult.isReused) return txResult.attempt;

    const { attempt } = txResult;
    try {
      const result = await instance.createIntent({
        amount,
        merchant_txn_id: attempt.merchant_txn_id,
        tenant_name: tenant.profiles.name,
        tenant_email: tenant.profiles.email,
        tenant_phone: tenant.profiles.phone || "",
        metadata: { tenant_id: tenantId, attempt_id: attempt.id, payment_type: "DEPOSIT" },
      });
      return await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "PENDING",
        source: "CREATE_INTENT",
        reason: "provider checkout created",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: {
          gateway_txn_id: result.gateway_txn_id,
          ...this.attemptIdentityData(attempt.merchant_txn_id, result),
          upi_intent_url: result.upi_intent_url,
          qr_payload: result.qr_payload,
          checkout_url: result.checkout_url,
          expires_at: result.expires_at,
          raw_create_response: result.raw_response as any,
        },
      });
    } catch (error) {
      await this.updateAttemptStatusOutsideTx({
        attemptId: attempt.id,
        fromStatus: "CREATED",
        toStatus: "FAILED",
        source: "CREATE_INTENT",
        reason: "provider checkout creation failed",
        operationalOwnerId: ownerId,
        financialOwnerId: ownerId,
        hostelId,
        data: { raw_create_response: { error: String(error) } as any, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
      });
      throw error;
    }
  }

  async previewPaymentAmount(obligationIds: string[], userId: string, tenantId?: string) {
    const obligations = await prisma.rent_obligations.findMany({
      where: { id: { in: obligationIds } },
      include: { payments: { select: { amount_paid: true } } }
    });

    if (obligations.length === 0) {
      throw new Error("NOT_FOUND: No obligations found");
    }
    if (obligations.length !== obligationIds.length) {
      const foundIds = new Set(obligations.map(o => o.id));
      const missing = obligationIds.filter(id => !foundIds.has(id));
      throw new Error(`NOT_FOUND: Obligations not found: ${missing.join(", ")}`);
    }

    const tenantIds = Array.from(new Set(obligations.map(o => o.tenant_id).filter(Boolean)));
    if (tenantIds.length > 1) {
      throw new Error("BAD_REQUEST: All obligations must belong to the same tenant");
    }
    const singleTenantId = tenantIds[0];
    if (tenantId && singleTenantId !== tenantId) {
      throw new Error("FORBIDDEN: You can only preview your own obligations");
    }

    const items = obligations.map(ob => {
      const paidPaisa = ob.payments.reduce((sum, p) => sum + Math.round(Number(p.amount_paid) * 100), 0);
      const duePaisa = Math.round(Number(ob.amount) * 100);
      const outstandingPaisa = Math.max(0, duePaisa - paidPaisa);
      return {
        id: ob.id,
        rent_month: ob.rent_month,
        obligation_type: ob.obligation_type,
        due_amount: Number(ob.amount),
        paid_amount: paidPaisa / 100,
        outstanding_amount: outstandingPaisa / 100,
        status: ob.status,
      };
    });

    const totalOutstandingPaisa = items.reduce((sum, item) => sum + Math.round(item.outstanding_amount * 100), 0);

    return {
      obligations: items,
      total_outstanding: totalOutstandingPaisa / 100,
      currency: "INR",
    };
  }

  async getPaymentAttempt(attemptId: string, userId: string, role: string, tenantId?: string) {
    const attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new Error("NOT_FOUND: Payment attempt not found");

    if (role === "TENANT" && attempt.tenant_id !== tenantId) {
      throw new Error("FORBIDDEN: You can only view your own attempts");
    }
    if (role === "OWNER" && attempt.owner_id !== userId) {
      throw new Error("FORBIDDEN: You can only view attempts for your hostel");
    }

    return this.mapAttemptWithRawResponse(attempt);
  }

  async replayCapturedPayment(
    attemptId: string,
    gatewayTxnId: string,
    rawPayload?: any,
    context?: { requestId?: string; source?: string; actor?: { id: string; ip?: string } }
  ) {
    const preAttempt = await prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!preAttempt) {
      throw new Error(`NOT_FOUND: Payment attempt ${attemptId} not found`);
    }

    // Record the verification snapshot for this replayed payment attempt
    await paymentProviderVerificationSnapshotService.record({
      provider: "RAZORPAY",
      source: "RECONCILE",
      attempt: preAttempt,
      providerTransactionId: gatewayTxnId,
      providerOrderId: rawPayload?.order_id || null,
      providerStatus: "captured",
      normalizedStatus: "SUCCESS",
      amount: Number(preAttempt.amount),
      rawResponse: rawPayload || {},
    });

    // Force transition the attempt from terminal back to PENDING so finalizePaymentAttempt can run normally
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { 
        status: "PENDING",
        flow_type: "RENT"
      },
    });

    return this.finalizePaymentAttempt(attemptId, "SUCCESS", gatewayTxnId, rawPayload, {
      ...context,
      lockAcquired: false,
    } as any);
  }

  async finalizePaymentAttempt(
    attemptId: string,
    status: string,
    gatewayTxnId?: string,
    rawPayload?: any,
    context?: { requestId?: string; source?: string; actor?: { id: string; ip?: string } }
  ) {
    const requestMeta = context?.requestId ? { request_id: context.requestId } : {};
    const resolveSource = (isManual?: boolean) => {
      const s = context?.source?.toUpperCase();
      if (s === "RECONCILE") return "RECONCILE";
      if (s === "WEBHOOK") return "WEBHOOK";
      if (s === "MANUAL_CONFIRM" || isManual) return "MANUAL_CONFIRM";
      return "VERIFY";
    };

    // ── Step 1: Acquire exclusive PROCESSING lock ──────────────────────────────
    // Atomically claim the attempt before reading or writing anything.
    // Only PENDING and PENDING_VERIFICATION can transition to PROCESSING:
    //   PENDING            → still waiting for webhook/verify
    //   PENDING_VERIFICATION → webhook claimed it, now we finalize
    // If count === 0 the attempt is already PROCESSING (another caller beat us)
    // or already terminal (SUCCESS/FAILED/etc.). Re-read and return — no work.
    const preLockAttempt = await prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true, owner_id: true, hostel_id: true, payment_domain: true, flow_type: true },
    });

    const isLockAcquired = (context as any)?.lockAcquired === true;
    const allowedStatuses = ["PENDING", "PENDING_VERIFICATION", "PENDING_MANUAL_CONFIRMATION"];
    if (isLockAcquired) {
      allowedStatuses.push("PROCESSING");
    }

    const lockResult = await prisma.paymentAttempt.updateMany({
      where: { id: attemptId, status: { in: allowedStatuses } },
      data: { status: "PROCESSING" },
    });

    if (lockResult.count === 0) {
      const fresh = await prisma.paymentAttempt.findUnique({
        where: { id: attemptId },
        include: { payments: true },
      });
      if (!fresh) throw new Error("NOT_FOUND: Attempt not found");
      if (["SUCCESS", "FAILED", "EXPIRED", "CANCELLED"].includes(fresh.status)) {
        logger.info("payments.finalize.already_terminal", { ...requestMeta, attempt_id: attemptId, status: fresh.status });
      } else {
        logger.info("payments.finalize.lock_contention", { ...requestMeta, attempt_id: attemptId, status: fresh.status });
      }
      return this.mapAttemptWithRawResponse(fresh);
    }

    logger.info("payments.finalize.lock_acquired", { ...requestMeta, attempt_id: attemptId, incoming_status: status });
    if (!isLockAcquired) {
      await paymentStatusEventService.appendOutsideTransaction({
        attemptId,
        fromStatus: preLockAttempt?.status || null,
        toStatus: "PROCESSING",
        source: resolveSource(),
        reason: "attempt claimed for settlement",
        actorId: context?.actor?.id || null,
        operationalOwnerId: preLockAttempt?.owner_id || null,
        financialOwnerId: this.isPlatformBillingAttempt(preLockAttempt) ? this.hmsFinancialOwnerId() : preLockAttempt?.owner_id || null,
        hostelId: preLockAttempt?.hostel_id || null,
      });
    }

    // ── Step 2: Read current state (status = PROCESSING — we own the lock) ─────
    const attempt = await prisma.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: { payments: true }
    });
    if (!attempt) throw new Error("NOT_FOUND: Attempt not found");

    // ──────────────────────────────────────────────────────────────
    // 🎁 ADDON PATH: Reminder pack credit allocation
    // ──────────────────────────────────────────────────────────────
    if (this.isAddonAttempt(attempt)) {
      // Non-success statuses: record and exit
      if (status !== "SUCCESS") {
        logger.info("addons.webhook.non_success", { ...requestMeta, attempt_id: attemptId, status });
        return await this.updateAttemptStatusOutsideTx({
          attemptId,
          fromStatus: "PROCESSING",
          toStatus: status,
          source: resolveSource(),
          reason: "provider returned non-success status for addon",
          operationalOwnerId: attempt.owner_id,
          financialOwnerId: this.hmsFinancialOwnerId(),
          hostelId: null,
          data: { gateway_txn_id: gatewayTxnId, raw_webhook_payload: rawPayload || null, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
        });
      }

      // ── Security: validate pack is from allow-list ────────────────
      const pack = attempt.addon_pack as string | null;
      const PACK_MAP: Record<string, { credits: number; amount: number }> = {
        "TEST_1": { credits: 1, amount: 1 },
        "200": { credits: 200, amount: 99 },
        "500": { credits: 500, amount: 199 },
      };

      if (!pack || !PACK_MAP[pack]) {
        logger.error("addons.webhook.invalid_pack", { ...requestMeta, attempt_id: attemptId, pack });
        throw new Error(`VALIDATION_ERROR: Unknown addon pack: "${pack}"`);
      }

      // ── Security: validate payment amount matches pack price ──────
      // This closes the fraud hole where someone tampers the checkout amount.
      const expectedAmount = PACK_MAP[pack].amount;
      const actualAmountPaisa   = Math.round(Number(attempt.amount) * 100);
      const expectedAmountPaisa = Math.round(expectedAmount * 100);

      if (actualAmountPaisa !== expectedAmountPaisa) {
        logger.error("addons.webhook.amount_mismatch", {
          ...requestMeta,
          attempt_id: attemptId,
          pack,
          expected_paise: expectedAmountPaisa,
          actual_paise: actualAmountPaisa,
        });
        // Mark attempt FAILED — do NOT credit
        await this.updateAttemptStatusOutsideTx({
          attemptId,
          fromStatus: "PROCESSING",
          toStatus: "FAILED",
          source: resolveSource(),
          reason: "addon amount mismatch",
          operationalOwnerId: attempt.owner_id,
          financialOwnerId: this.hmsFinancialOwnerId(),
          hostelId: null,
          data: { raw_webhook_payload: rawPayload || null, settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
        });
        throw new Error(`VALIDATION_ERROR: Amount mismatch for addon pack "${pack}". Expected ₹${expectedAmount}, got ₹${Number(attempt.amount)}.`);
      }

      const credits = PACK_MAP[pack].credits;

      // ── Atomic: updateMany as idempotency gate ────────────────────
      // updateMany returns count=0 if status is already SUCCESS/FAILED/etc.
      // This makes double-crediting structurally impossible — not just a runtime check.
      let credited = false;
      await prisma.$transaction(async (tx) => {
        const gate = await tx.paymentAttempt.updateMany({
          where: { id: attemptId, status: { in: ["PENDING", "PROCESSING"] } },
          data: {
            status: "SUCCESS",
            gateway_txn_id: gatewayTxnId,
            raw_webhook_payload: rawPayload || null,
            confirmed_at: new Date(),
            settlement_status: SETTLEMENT_STATUS.SETTLED,
            settled_at: new Date(),
          },
        });

        // gate.count === 0 → already finalized → no credit
        if (gate.count === 0) {
          logger.info("addons.webhook.idempotent_skip", { ...requestMeta, attempt_id: attemptId });
          return;
        }
        await paymentStatusEventService.append(tx, {
          attemptId,
          fromStatus: "PROCESSING",
          toStatus: "SUCCESS",
          source: resolveSource(),
          reason: "addon credits credited atomically",
          operationalOwnerId: attempt.owner_id,
          financialOwnerId: this.hmsFinancialOwnerId(),
          hostelId: null,
          metadata: { pack, credits },
        });

        // ── Soft cap: prevent abuse / overflow ────────────────────
        const current = await tx.addonUsage.findUnique({
          where: { owner_id: attempt.owner_id },
          select: { reminders_remaining: true },
        });
        const currentBalance = current?.reminders_remaining ?? 0;
        const CREDIT_CAP = 10_000;

        if (currentBalance + credits > CREDIT_CAP) {
          logger.warn("addons.webhook.cap_exceeded", {
            ...requestMeta,
            attempt_id: attemptId,
            owner_id: attempt.owner_id,
            current_balance: currentBalance,
            credits,
          });
          throw new Error(`CREDIT_CAP_EXCEEDED: Balance would exceed ${CREDIT_CAP.toLocaleString()} credits. Current: ${currentBalance}.`);
        }

        // Credit the account
        await tx.addonUsage.upsert({
          where: { owner_id: attempt.owner_id },
          update: { reminders_remaining: { increment: credits } },
          create: { owner_id: attempt.owner_id, reminders_remaining: credits + 5, reminders_used: 0 },
        });

        // Audit trail: immutable ledger entry
        await tx.addonTransactions.create({
          data: {
            owner_id: attempt.owner_id,
            payment_attempt_id: attemptId,
            pack,
            credits_added: credits,
          },
        });

        credited = true;
      }); // end $transaction

      if (credited) {
        logger.info("addons.credits_allocated", {
          ...requestMeta,
          attempt_id: attemptId,
          owner_id: attempt.owner_id,
          pack,
          credits,
        });
        await eventLog.log("ADDON_CREDITS_ADDED", attempt.owner_id, {
          pack,
          credits,
          payment_attempt_id: attemptId,
          gateway_txn_id: gatewayTxnId,
        }).catch(() => {});
      }

      return this.mapAttemptWithRawResponse(await prisma.paymentAttempt.findUnique({ where: { id: attemptId } }));
    } // end ADDON PATH



    // ──────────────────────────────────────────────────────────────
    // 💰 RENT PATH: Obligation payment (existing logic)
    // ──────────────────────────────────────────────────────────────

    if (status !== "SUCCESS") {
      logger.info("payments.finalize.rent_non_success", { ...requestMeta, attempt_id: attemptId, status });
      return await this.updateAttemptStatusOutsideTx({
        attemptId,
        fromStatus: "PROCESSING",
        toStatus: status,
        source: resolveSource(),
        reason: "provider returned non-success status",
        operationalOwnerId: attempt.owner_id,
        financialOwnerId: attempt.owner_id,
        hostelId: attempt.hostel_id,
        data: {
          gateway_txn_id: gatewayTxnId,
          raw_webhook_payload: rawPayload || null,
          settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE,
        },
      });
    }


    const isManualConfirm = context?.source === "MANUAL_CONFIRM";

    // ──────────────────────────────────────────────────────────────
    // 💎 ADVANCE PATH: Gateway-driven future rent credit, no obligation linkage
    // ──────────────────────────────────────────────────────────────
    if ((attempt as any).payment_domain === PAYMENT_DOMAIN.RENT_COLLECTION && ((attempt as any).flow_type === PAYMENT_FLOW.FUTURE_RENT_CREDIT || (attempt as any).flow_type === "ADVANCE")) {
      if (!attempt.tenant_id) {
        throw new Error("INTERNAL: ADVANCE payment attempt is missing tenant_id");
      }
      const advanceTenantId: string = attempt.tenant_id;
      const finalizedAdvance = await prisma.$transaction(async (tx) => {
        // Lock ordering: tenant row first (consistent with adjustAgainstObligation)
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${advanceTenantId}::uuid FOR UPDATE`;
        const initialOutstanding = await this.getTenantOutstandingInTx(tx, advanceTenantId, attempt.hostel_id);
        const initialLedgerBalance = await this.getTenantLedgerBalanceInTx(tx, advanceTenantId);

        await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
          tenantId: advanceTenantId,
          ownerId: attempt.owner_id,
          amount: Number(attempt.amount),
          referenceId: attempt.id,
          referenceType: "PAYMENT_ATTEMPT",
          createdBy: attempt.owner_id,
          reason: "TOPUP",
          notes: "Gateway future rent payment credited",
        });
        const finalized = await this.updateAttemptStatus(tx, {
          attemptId,
          fromStatus: "PROCESSING",
          toStatus: "SUCCESS",
          source: resolveSource(isManualConfirm),
          reason: "advance ledger credited atomically",
          actorId: context?.actor?.id || null,
          operationalOwnerId: attempt.owner_id,
          financialOwnerId: attempt.owner_id,
          hostelId: attempt.hostel_id,
          data: {
            gateway_txn_id: gatewayTxnId,
            raw_webhook_payload: rawPayload || null,
            confirmed_at: new Date(),
            settlement_status: SETTLEMENT_STATUS.SETTLED,
            settled_at: new Date(),
            ...(isManualConfirm && context?.actor ? {
              manual_confirmed_by: context.actor.id,
              manual_confirmed_at: new Date(),
              manual_confirm_ip: context.actor.ip ?? null,
            } : {}),
          },
        });

        await this.recordGatewayCaptureInTx(tx, attempt, gatewayTxnId, rawPayload);

        await this.validatePaymentAttemptSettlementInTx(tx, {
          attemptId,
          initialOutstanding,
          initialLedgerBalance,
          tenantId: advanceTenantId,
          hostelId: attempt.hostel_id,
        });

        return finalized;
      });
      logger.info("payments.finalize.advance_credited", {
        ...requestMeta,
        attempt_id: attemptId,
        amount: Number(attempt.amount),
        tenant_id: attempt.tenant_id,
      });
      await eventLog.log("ADVANCE_CREDITED", attempt.owner_id, {
        attempt_id: attemptId,
        merchant_txn_id: attempt.merchant_txn_id,
        amount: Number(attempt.amount),
        tenant_id: attempt.tenant_id,
        gateway_txn_id: gatewayTxnId || null,
      });

      // Notify owner about the confirmed advance payment
      try {
        const tenantProfile = await prisma.tenants.findUnique({
          where: { id: attempt.tenant_id },
          include: { profiles: true },
        });
        const tenantName = tenantProfile?.profiles?.name || "A tenant";
        const roomNo = tenantProfile?.room_no || "N/A";

        await prisma.notifications.create({
          data: {
            id: crypto.randomUUID(),
            profile_id: attempt.owner_id,
            title: "Bulk Advance Payment Confirmed",
            message: `${tenantName} (Room ${roomNo}) advance payment of ₹${attempt.amount} has been confirmed.`,
            type: "payment"
          }
        });
      } catch (notificationErr) {
        logger.error("Failed to notify owner on successful advance payment finalization:", notificationErr);
      }

      await eventSystem.trigger("advance_credited", {
        tenant_id: attempt.tenant_id,
        owner_id: attempt.owner_id,
        hostel_id: attempt.hostel_id,
        amount: Number(attempt.amount),
        reason: "TOPUP",
        entry_id: null,
      });

      return finalizedAdvance;
    }

    // ──────────────────────────────────────────────────────────────
    // 🧾 DEPOSIT PATH: Gateway-driven onboarding security deposit
    // ──────────────────────────────────────────────────────────────
    if ((attempt as any).payment_domain === PAYMENT_DOMAIN.RENT_COLLECTION && ((attempt as any).flow_type === PAYMENT_FLOW.SECURITY_DEPOSIT || (attempt as any).flow_type === "DEPOSIT")) {
      if (!attempt.tenant_id) {
        throw new Error("INTERNAL: DEPOSIT payment attempt is missing tenant_id");
      }
      const depositTenantId: string = attempt.tenant_id;
      const finalizedDeposit = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${depositTenantId}::uuid FOR UPDATE`;
        const initialOutstanding = await this.getTenantOutstandingInTx(tx, depositTenantId, attempt.hostel_id);
        const initialLedgerBalance = await this.getTenantLedgerBalanceInTx(tx, depositTenantId);

        await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
          tenantId: depositTenantId,
          ownerId: attempt.owner_id,
          amount: Number(attempt.amount),
          referenceId: attempt.id,
          referenceType: "PAYMENT_ATTEMPT",
          createdBy: attempt.owner_id,
          reason: "SECURITY_DEPOSIT_COLLECTED",
          notes: "Gateway security deposit payment credited",
        });
        const finalized = await this.updateAttemptStatus(tx, {
          attemptId,
          fromStatus: "PROCESSING",
          toStatus: "SUCCESS",
          source: resolveSource(isManualConfirm),
          reason: "deposit ledger credited atomically",
          actorId: context?.actor?.id || null,
          operationalOwnerId: attempt.owner_id,
          financialOwnerId: attempt.owner_id,
          hostelId: attempt.hostel_id,
          data: {
            gateway_txn_id: gatewayTxnId,
            raw_webhook_payload: rawPayload || null,
            confirmed_at: new Date(),
            settlement_status: SETTLEMENT_STATUS.SETTLED,
            settled_at: new Date(),
            ...(isManualConfirm && context?.actor ? {
              manual_confirmed_by: context.actor.id,
              manual_confirmed_at: new Date(),
              manual_confirm_ip: context.actor.ip ?? null,
            } : {}),
          },
        });

        await this.recordGatewayCaptureInTx(tx, attempt, gatewayTxnId, rawPayload);

        await this.validatePaymentAttemptSettlementInTx(tx, {
          attemptId,
          initialOutstanding,
          initialLedgerBalance,
          tenantId: depositTenantId,
          hostelId: attempt.hostel_id,
        });

        return finalized;
      });
      logger.info("payments.finalize.deposit_credited", {
        ...requestMeta,
        attempt_id: attemptId,
        amount: Number(attempt.amount),
        tenant_id: attempt.tenant_id,
      });
      await eventLog.log("DEPOSIT_CREDITED", attempt.owner_id, {
        attempt_id: attemptId,
        merchant_txn_id: attempt.merchant_txn_id,
        amount: Number(attempt.amount),
        tenant_id: attempt.tenant_id,
        gateway_txn_id: gatewayTxnId || null,
      });

      await eventSystem.trigger("advance_credited", {
        tenant_id: attempt.tenant_id,
        owner_id: attempt.owner_id,
        hostel_id: attempt.hostel_id,
        amount: Number(attempt.amount),
        reason: "DEPOSIT",
        entry_id: null,
      });

      return finalizedDeposit;
    }

    // Use ONLY junction table - no fallback to raw_create_response
    const obligationLinks = await prisma.payment_attempt_obligations.findMany({
      where: { payment_attempt_id: attemptId }
    });
    const attemptHostelId = requireFinancialHostelId(attempt.hostel_id, "rent payment attempt finalization");

    // Single atomic transaction — all obligation payments succeed or all roll back.
    // _applyPaymentInTx is used directly so we don't nest prisma.$transaction calls.
    const appliedPayments: { payment: any; newStatus: string; tenantId: string; ownerId: string }[] = [];

    let updatedAttempt: any = null;
    if (attempt.payments.length > 0) {
      updatedAttempt = await this.updateAttemptStatusOutsideTx({
        attemptId,
        fromStatus: "PROCESSING",
        toStatus: "SUCCESS",
        source: resolveSource(isManualConfirm),
        reason: "rent attempt already has ledger payments",
        actorId: context?.actor?.id || null,
        operationalOwnerId: attempt.owner_id,
        financialOwnerId: attempt.owner_id,
        hostelId: attempt.hostel_id,
        data: {
          gateway_txn_id: gatewayTxnId,
          raw_webhook_payload: rawPayload || null,
          confirmed_at: new Date(),
          settlement_status: SETTLEMENT_STATUS.SETTLED,
          settled_at: new Date(),
        },
      });
    } else {
    updatedAttempt = await prisma.$transaction(async (tx) => {
      if (attempt.tenant_id) {
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${attempt.tenant_id}::uuid FOR UPDATE`;
      }
      const initialOutstanding = attempt.tenant_id
        ? await this.getTenantOutstandingInTx(tx, attempt.tenant_id, attempt.hostel_id)
        : 0;
      const initialLedgerBalance = attempt.tenant_id
        ? await this.getTenantLedgerBalanceInTx(tx, attempt.tenant_id)
        : 0;

      if (obligationLinks.length > 0) {
        // Unified onto the Settlement Planner/Engine (previously a hand-rolled
        // priority sort + allocation loop duplicating settlement-engine's job).
        //
        // Safety: for createMultiObligationPaymentIntent, attempt.amount is
        // provably always equal to sum(obligationLinks.amount) — both are
        // computed from the same loop inside the same transaction at
        // intent-creation time, and payment_attempt_obligations rows are
        // never mutated after insert. That equality does NOT hold for
        // createAmountPaymentIntent: there attempt.amount may EXCEED
        // sum(obligationLinks.amount) when the entered amount is more than
        // total outstanding — the difference is intentionally routed to
        // future rent credit. Correctness here does not come from junction-
        // sum equality; it comes from receivePayment below re-planning
        // against amountPaid (the full captured amount) each time, with
        // obligationLinks only supplying which obligations are eligible.
        //
        // obligationIdFilter (not allowedObligationIds) restricts the fetch to
        // exactly the linked set, so the planner's chronology validation is
        // skipped by design (the fetched set IS the allowed set) — passing
        // allowedObligationIds instead would risk the planner rejecting the
        // whole plan into 100% future credit if an unrelated obligation older
        // than a linked one appeared between intent-creation and finalization.
        const linkedObligationIds = obligationLinks.map(l => l.obligation_id);
        const settlement = await financialPaymentFacade.receivePayment(tx, {
          hostelId: attemptHostelId,
          tenantId: attempt.tenant_id!,
          amountPaid: Number(attempt.amount),
          paymentMethod: "UPI",
          referenceNumber: gatewayTxnId || attempt.merchant_txn_id,
          paymentDate: new Date(),
          paymentAttemptId: attempt.id,
          ownerId: attempt.owner_id,
          obligationIdFilter: linkedObligationIds,
        }, attempt.id);
        for (const allocation of settlement.allocations) {
          appliedPayments.push({
            payment: {
              id: allocation.payment_id,
              obligation_id: allocation.obligation_id,
              tenant_id: attempt.tenant_id,
              owner_id: allocation.owner_id,
              hostel_id: attemptHostelId,
              amount_paid: allocation.allocated,
            },
            newStatus: allocation.new_status,
            tenantId: attempt.tenant_id!,
            ownerId: allocation.owner_id,
          });
        }
        if (settlement.settlementBreakdown) {
          await tx.paymentAttempt.update({
            where: { id: attemptId },
            data: { settlement_breakdown: settlement.settlementBreakdown },
          });
        }
      } else if (attempt.obligation_id) {
        // Single obligation payment — routed through the same plan+execute
        // flow as every other settlement path (paymentAttemptId is set, so
        // the engine skips plan-rejection just like the sibling branches).
        const singleObligation = await tx.rent_obligations.findUnique({
          where: { id: attempt.obligation_id },
          select: { tenant_id: true },
        });
        if (!singleObligation) throw new Error("NOT_FOUND: Obligation not found");

        const settlement = await financialPaymentFacade.receivePayment(tx, {
          hostelId: attemptHostelId,
          tenantId: singleObligation.tenant_id,
          amountPaid: Number(attempt.amount),
          paymentMethod: "UPI",
          referenceNumber: gatewayTxnId || attempt.merchant_txn_id,
          paymentDate: new Date(),
          paymentAttemptId: attempt.id,
          obligationIdFilter: [attempt.obligation_id],
        }, attempt.id);

        const allocation = settlement.allocations[0];
        if (!allocation) throw new Error("SETTLEMENT_FAILED: Rent payment attempt has no linked obligation to settle");

        appliedPayments.push({
          payment: {
            id: allocation.payment_id,
            obligation_id: allocation.obligation_id,
            tenant_id: singleObligation.tenant_id,
            owner_id: allocation.owner_id,
            hostel_id: attemptHostelId,
            amount_paid: allocation.allocated,
          },
          newStatus: allocation.new_status,
          tenantId: singleObligation.tenant_id,
          ownerId: allocation.owner_id,
        });
      } else if (attempt.tenant_id) {
        const rawResponse = attempt.raw_create_response as any;
        const allowedIds = rawResponse?.allowed_obligation_ids;
        const settlement = await this._settleTenantRentPaymentInTx(tx, {
          hostelId: attemptHostelId,
          tenantId: attempt.tenant_id,
          amountPaid: Number(attempt.amount),
          paymentMethod: "UPI",
          referenceNumber: gatewayTxnId || attempt.merchant_txn_id,
          paymentDate: new Date(),
          paymentAttemptId: attempt.id,
          userId: attempt.owner_id,
          ownerId: attempt.owner_id,
          allowedObligationIds: Array.isArray(allowedIds) ? allowedIds : undefined,
        }, attempt.id);
        for (const allocation of settlement.allocations) {
          appliedPayments.push({
            payment: {
              id: allocation.payment_id,
              obligation_id: allocation.obligation_id,
              tenant_id: attempt.tenant_id,
              owner_id: allocation.owner_id,
              hostel_id: attemptHostelId,
              amount_paid: allocation.allocated,
            },
            newStatus: allocation.new_status,
            tenantId: attempt.tenant_id,
            ownerId: allocation.owner_id,
          });
        }
        // V2: Store immutable settlement breakdown JSONB
        if (settlement.settlementBreakdown) {
          await tx.paymentAttempt.update({
            where: { id: attemptId },
            data: { settlement_breakdown: settlement.settlementBreakdown },
          });
        }
      }
      // If neither — invoice payment or no linkage (handled in billing path above)
      if (appliedPayments.length === 0 && !attempt.tenant_id) {
        throw new Error("SETTLEMENT_FAILED: Rent payment attempt has no linked obligations to settle");
      }
      const finalized = await this.updateAttemptStatus(tx, {
        attemptId,
        fromStatus: "PROCESSING",
        toStatus: "SUCCESS",
        source: resolveSource(isManualConfirm),
        reason: "rent ledger settled atomically",
        actorId: context?.actor?.id || null,
        operationalOwnerId: attempt.owner_id,
        financialOwnerId: attempt.owner_id,
        hostelId: attempt.hostel_id,
        data: {
          gateway_txn_id: gatewayTxnId,
          raw_webhook_payload: rawPayload || null,
          confirmed_at: new Date(),
          settlement_status: SETTLEMENT_STATUS.SETTLED,
          settled_at: new Date(),
          ...(isManualConfirm && context?.actor ? {
            manual_confirmed_by: context.actor.id,
            manual_confirmed_at: new Date(),
            manual_confirm_ip: context.actor.ip ?? null,
          } : {}),
        },
      });

      await this.recordGatewayCaptureInTx(tx, attempt, gatewayTxnId, rawPayload);

      if (attempt.tenant_id) {
        await this.validatePaymentAttemptSettlementInTx(tx, {
          attemptId,
          initialOutstanding,
          initialLedgerBalance,
          tenantId: attempt.tenant_id,
          hostelId: attempt.hostel_id,
        });
      }

      return finalized;
    }, { maxWait: 15000, timeout: 30000 });
    }
    logger.info("payments.finalize.marked_success", { ...requestMeta, attempt_id: attemptId, gateway_txn_id: gatewayTxnId ?? null, source: context?.source ?? "auto" });

    // Once per attempt, deliberately outside the loop below: a FIFO settlement
    // creates one payments row per obligation it touches, and the owner cares
    // that a person paid him — not how many months it happened to cover.
    if (attempt?.owner_id) {
      await notifyTenantPaid({
        ownerId: attempt.owner_id,
        tenantId: attempt.tenant_id ?? null,
        amount: Number(attempt.amount),
      });
    }

    // Post-transaction side-effects: events, receipts, audit logs
    for (const { payment, tenantId: tId } of appliedPayments) {
      await eventSystem.trigger("payment_recorded", {
        payment_id: payment.id,
        obligation_id: payment.obligation_id,
        tenant_id: tId,
        owner_id: payment.owner_id,
        hostel_id: payment.hostel_id,
        amount: Number(payment.amount_paid),
        method: "UPI",
        attempt_id: attemptId,
      });
    }
    if (appliedPayments.length > 0) {
      receiptService.createReceipt(appliedPayments[0].payment.id).catch(err =>
        logger.error("payments.finalize.receipt_failed", { attempt_id: attemptId, error: String(err) })
      );
    }
    await eventLog.log("PAYMENT_FINALIZED", attempt.owner_id, {
      attempt_id: attemptId,
      merchant_txn_id: attempt.merchant_txn_id,
      gateway_txn_id: gatewayTxnId || null,
      obligation_count: appliedPayments.length,
    });

    return updatedAttempt;
  }

  async handlePaymentWebhook(providerName: string, headers: any, body: any, context?: { requestId?: string; webhookEventId?: string }) {
    const providerStr = providerName.toUpperCase();
    const requestMeta = context?.requestId ? { request_id: context.requestId } : {};
    
    let merchantOrderId: string | null = null;
    
    try {
      let parsed = body;
      if (typeof body === "string") parsed = JSON.parse(body);
      if (providerStr === "PHONEPE") {
        merchantOrderId = parsed?.payload?.merchantOrderId || null;
      } else if (providerStr === "RAZORPAY") {
        const pl = parsed?.payload || {};
        merchantOrderId = pl.order?.entity?.receipt || 
                          pl.payment?.entity?.notes?.merchant_txn_id || 
                          pl.payment?.entity?.notes?.merchant_transaction_id || 
                          parsed?.notes?.merchant_txn_id ||
                          null;
      }
    } catch (e) {
      logger.warn("payments.webhook.merchant_order_id_extract_failed", {
        ...requestMeta,
        error: String(e),
      });
    }

    if (!merchantOrderId) {
      throw new Error("BAD_REQUEST: Webhook payload missing merchantOrderId");
    }

    // Direct lookup - O(1) and safe
    const attempt = await prisma.paymentAttempt.findFirst({
      where: {
        OR: [
          { merchant_txn_id: merchantOrderId },
          { merchant_transaction_id: merchantOrderId },
        ],
      }
    });

    if (!attempt) {
      throw new Error(`NOT_FOUND: Payment attempt not found for merchant_txn_id: ${merchantOrderId}`);
    }
    if (context?.webhookEventId) {
      await paymentWebhookEventService.markProcessing(context.webhookEventId).catch(() => {});
    }

    if (attempt.provider !== providerStr) {
      throw new Error(`BAD_REQUEST: Webhook provider ${providerStr} does not match attempt provider ${attempt.provider}`);
    }

    // Idempotency check with ATOMIC LOCKING
    const lockResult = await prisma.paymentAttempt.updateMany({
      where: { 
        id: attempt.id, 
        status: { in: ["PENDING", "CREATED", "PENDING_VERIFICATION"] } 
      },
      data: { 
        status: "PROCESSING",
        updated_at: new Date()
      }
    });

    if (lockResult.count === 0) {
      logger.info("payments.webhook.attempt_already_processed_or_locked", {
        ...requestMeta,
        attemptId: attempt.id,
        status: attempt.status,
      });
      incrementWebhook(true); // Already processed, not an error
      if (context?.webhookEventId) {
        await paymentWebhookEventService.markProcessed(context.webhookEventId, {
          attempt_id: attempt.id,
          status: attempt.status,
          idempotent: true,
        }).catch(() => {});
      }
      return { success: true, message: `Attempt already processed or locked` };
    }
    await paymentStatusEventService.appendOutsideTransaction({
      attemptId: attempt.id,
      fromStatus: attempt.status,
      toStatus: "PROCESSING",
      source: "WEBHOOK",
      reason: "webhook claimed attempt for provider source-of-truth verification",
      operationalOwnerId: attempt.owner_id,
      financialOwnerId: this.isPlatformBillingAttempt(attempt) ? this.hmsFinancialOwnerId() : attempt.owner_id,
      hostelId: this.isPlatformBillingAttempt(attempt) ? null : attempt.hostel_id,
      metadata: { provider: providerStr, webhookEventId: context?.webhookEventId || null },
    }).catch((error) => {
      logger.warn("payments.webhook.status_event_failed", {
        ...requestMeta,
        attempt_id: attempt.id,
        error: String(error),
      });
    });

    logger.info("payments.webhook.attempt_matched", {
      ...requestMeta,
      provider: providerStr,
      attemptId: attempt.id,
      merchantTxnId: attempt.merchant_txn_id,
      hasVerifyHeader: Boolean(headers?.["x-verify"] || headers?.["X-VERIFY"]),
    });

    try {
      const { instance } = await this.getProviderInstanceForAttempt(attempt, "payment webhook verification");
      
      // 1. Initial parsing of the webhook payload
      const verification = await instance.verifyWebhook(headers, body);
      
      if (verification.merchant_txn_id !== attempt.merchant_txn_id) {
         throw new Error(`SECURITY_ERROR: Webhook merchantTxnId ${verification.merchant_txn_id} does not match DB ${attempt.merchant_txn_id}`);
      }

      // Razorpay strict metadata checks
      if (providerStr === "RAZORPAY") {
        const attemptOrderId = attempt.provider_order_id || attempt.gateway_txn_id;
        const webhookOrderId = verification.provider_order_id || verification.gateway_txn_id;
        if (attemptOrderId && attemptOrderId !== webhookOrderId) {
          throw new Error(`SECURITY_ERROR: Webhook order_id ${webhookOrderId} does not match DB ${attemptOrderId}`);
        }

        if (verification.amount !== undefined && verification.amount !== null && Math.round(Number(verification.amount) * 100) !== Math.round(Number(attempt.amount) * 100)) {
          throw new Error(`SECURITY_ERROR: Webhook amount ${verification.amount} does not match DB ${attempt.amount}`);
        }

        const webhookTenantId = verification.tenant_id;
        if (webhookTenantId && webhookTenantId !== attempt.tenant_id) {
          throw new Error(`SECURITY_ERROR: Webhook tenant_id ${webhookTenantId} does not match DB ${attempt.tenant_id}`);
        }
      }

      // 2. CRITICAL SECURITY: Never trust webhook payload blindly.
      // Call out to the payment provider to fetch the absolute source of truth status.
      let sourceOfTruth;
      try {
        sourceOfTruth = await instance.fetchStatus(attempt.merchant_txn_id, verification.gateway_txn_id || undefined);
      } catch (e) {
        // SRE FIX: If the provider API is down, save the raw webhook payload so we don't lose the event data
        // even though we are returning 500 and expecting a retry.
        await prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { raw_webhook_payload: verification.raw_event }
        });
        throw e;
      }
      await paymentProviderVerificationSnapshotService.record({
        provider: providerStr,
        source: "WEBHOOK",
        attempt,
        webhookEventId: context?.webhookEventId || null,
        providerTransactionId: sourceOfTruth.provider_transaction_id || verification.provider_transaction_id || null,
        providerOrderId: sourceOfTruth.provider_order_id || verification.provider_order_id || sourceOfTruth.gateway_txn_id || verification.gateway_txn_id || null,
        providerReferenceId: sourceOfTruth.provider_reference_id || verification.provider_reference_id || null,
        providerStatus: (sourceOfTruth as any).provider_status || sourceOfTruth.status,
        normalizedStatus: sourceOfTruth.status,
        amount: verification.amount ?? null,
        rawResponse: sourceOfTruth.raw_status,
      });
      
      if (sourceOfTruth.status === "PENDING" && verification.status === "SUCCESS") {
        throw new Error(`SECURITY_ERROR: Webhook claimed SUCCESS but Provider API claims PENDING for ${attempt.merchant_txn_id}`);
      }

      const finalStatus = sourceOfTruth.status !== "PENDING" ? sourceOfTruth.status : verification.status;

      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          provider_transaction_id: sourceOfTruth.provider_transaction_id || verification.provider_transaction_id || null,
          provider_order_id: sourceOfTruth.provider_order_id || verification.provider_order_id || sourceOfTruth.gateway_txn_id || verification.gateway_txn_id || null,
          provider_reference_id: sourceOfTruth.provider_reference_id || verification.provider_reference_id || sourceOfTruth.provider_transaction_id || verification.provider_transaction_id || sourceOfTruth.gateway_txn_id || verification.gateway_txn_id || null,
        } as any,
      }).catch(async (error: any) => {
        if (String(error?.message || error).includes("Unique")) {
          await paymentOperationalAnomalyService.create({
            anomalyType: "DUPLICATE_PROVIDER_REFERENCE",
            severity: "HIGH",
            paymentDomain: (attempt as any).payment_domain,
            flowType: (attempt as any).flow_type,
            paymentAttemptId: attempt.id,
            webhookEventId: context?.webhookEventId || null,
            operationalOwnerId: attempt.owner_id,
            financialOwnerId: attempt.owner_id,
            hostelId: attempt.hostel_id,
            metadata: { provider: providerStr },
          });
        }
      });

      if (finalStatus === "SUCCESS") {
        const expectedPaise = Math.round(Number(attempt.amount) * 100);
        const receivedPaise =
          verification.amount == null ? null : Math.round(Number(verification.amount) * 100);

        // Only reject if amount IS present and doesn't match
        if (receivedPaise !== null && receivedPaise !== expectedPaise) {
          logger.error("payments.webhook.amount_mismatch", {
            ...requestMeta,
            attemptId: attempt.id,
            merchantTxnId: attempt.merchant_txn_id,
            expectedAmount: Number(attempt.amount),
            receivedAmount: verification.amount ?? null,
          });
          throw new Error("BAD_REQUEST: Webhook amount does not match payment attempt");
        }
      }

      logger.info("payments.webhook.verified", {
        ...requestMeta,
        attemptId: attempt.id,
        merchantTxnId: attempt.merchant_txn_id,
        status: verification.status,
      });
      
      const result = await this.finalizePaymentAttempt(
        attempt.id,
        finalStatus,
        sourceOfTruth.gateway_txn_id || verification.gateway_txn_id || undefined,
        verification.raw_event,
        {
          ...context,
          source: "WEBHOOK",
          lockAcquired: true,
        } as any
      );
      incrementWebhook(true);
      if (result?.status === "SUCCESS") incrementPayment("success");
      if (context?.webhookEventId) {
        await paymentWebhookEventService.markProcessed(context.webhookEventId, {
          attempt_id: attempt.id,
          final_status: result?.status || finalStatus,
        }).catch(() => {});
      }
      return result;
    } catch (webhookError) {
      // Revert status from PROCESSING back to what it was (attempt.status) so retries are allowed
      await prisma.paymentAttempt.updateMany({
        where: { id: attempt.id, status: "PROCESSING" },
        data: { status: attempt.status, updated_at: new Date() }
      }).catch((e) => {
        logger.warn("payments.webhook.revert_failed", { attemptId: attempt.id, error: String(e) });
      });
      throw webhookError;
    }
  }

  async verifyPaymentStatus(params: {
    userId: string;
    role: string;
    tenantId?: string;
    attemptId?: string;
    merchantTxnId?: string;
    gatewayTxnId?: string;
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  }) {
    const { userId, role, tenantId, attemptId, merchantTxnId, gatewayTxnId } = params;

    if (!attemptId && !merchantTxnId && !gatewayTxnId) {
      throw new Error("BAD_REQUEST: attempt_id or merchant_txn_id or gateway_txn_id is required");
    }

    const attempt = await prisma.paymentAttempt.findFirst({
      where: {
        OR: [
          ...(attemptId ? [{ id: attemptId }] : []),
          ...(merchantTxnId ? [{ merchant_txn_id: merchantTxnId }, { merchant_transaction_id: merchantTxnId }] : []),
          ...(gatewayTxnId ? [
            { gateway_txn_id: gatewayTxnId },
            { provider_transaction_id: gatewayTxnId },
            { provider_order_id: gatewayTxnId },
            { provider_reference_id: gatewayTxnId },
          ] : []),
        ]
      }
    });

    if (!attempt) {
      logger.warn("payments.verify.attempt_not_found", {
        userId,
        role,
        attemptId: attemptId || null,
        merchantTxnId: merchantTxnId || null,
        gatewayTxnId: gatewayTxnId || null,
      });
      throw new Error("NOT_FOUND: Payment attempt not found");
    }

    if (role === "TENANT" && attempt.tenant_id !== tenantId) {
      logger.warn("payments.verify.forbidden_tenant_mismatch", {
        userId,
        role,
        attemptTenantId: attempt.tenant_id,
        requestTenantId: tenantId,
        merchantTxnId: attempt.merchant_txn_id,
      });
      throw new Error("FORBIDDEN: You can only verify your own attempts");
    }
    if (role === "OWNER" && attempt.owner_id !== userId) {
      logger.warn("payments.verify.forbidden_owner_mismatch", {
        userId,
        role,
        attemptOwnerId: attempt.owner_id,
        requestUserId: userId,
        merchantTxnId: attempt.merchant_txn_id,
      });
      throw new Error("FORBIDDEN: You can only verify attempts for your hostel");
    }

    logger.info("payments.verify.attempt_found", {
      attemptId: attempt.id,
      merchantTxnId: attempt.merchant_txn_id,
      status: attempt.status,
      role,
    });

    if (["SUCCESS", "FAILED", "EXPIRED", "CANCELLED", "PENDING_MANUAL_CONFIRMATION"].includes(attempt.status)) {
      return {
        attempt: this.mapAttemptWithRawResponse(attempt),
        status: attempt.status,
        source: "cached"
      };
    }

    const { instance, config } = await this.getProviderInstanceForAttempt(attempt, "payment attempt verification");

    if (attempt.provider === "RAZORPAY") {
      const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = params;
      if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        throw new Error("BAD_REQUEST: Missing razorpay_payment_id, razorpay_order_id, or razorpay_signature for signature verification");
      }
      const keySecret = config?.key_secret;
      if (!keySecret) {
        throw new Error("CONFIG_ERROR: Razorpay key_secret not configured");
      }
      const expectedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");
      if (expectedSignature !== razorpay_signature) {
        await paymentOperationalAnomalyService.create({
          anomalyType: "WEBHOOK_SIGNATURE_FAILED",
          severity: "HIGH",
          paymentAttemptId: attempt.id,
          metadata: { reason: "Razorpay client callback signature mismatch", provider: "RAZORPAY" },
        });
        throw new Error("SECURITY_ERROR: Invalid Razorpay signature in verify payment");
      }
      logger.info("payments.verify.razorpay_signature_verified", {
        attemptId: attempt.id,
        razorpay_payment_id,
        razorpay_order_id,
      });

      // REPLAY PROTECTION: verify that the razorpay_order_id matches the attempt's stored gateway transaction/order ID
      const attemptOrderId = (attempt as any).provider_order_id || attempt.gateway_txn_id;
      if (attemptOrderId && attemptOrderId !== razorpay_order_id) {
        throw new Error("SECURITY_ERROR: razorpay_order_id mismatch");
      }

      let activeAttempt = attempt;
      if (["CREATED", "PENDING"].includes(attempt.status)) {
        const updateResult = await prisma.paymentAttempt.updateMany({
          where: { id: attempt.id, status: { in: ["CREATED", "PENDING"] } },
          data: {
            status: "PENDING_VERIFICATION",
            provider_transaction_id: razorpay_payment_id,
            provider_order_id: razorpay_order_id,
            gateway_txn_id: razorpay_order_id,
            updated_at: new Date(),
          }
        });

        if (updateResult.count > 0) {
          const fresh = await prisma.paymentAttempt.findUnique({ where: { id: attempt.id } });
          if (fresh) {
            activeAttempt = fresh;
            await paymentStatusEventService.appendOutsideTransaction({
              attemptId: attempt.id,
              fromStatus: attempt.status,
              toStatus: "PENDING_VERIFICATION",
              source: "VERIFY",
              reason: "client signature verified, verifying status inline",
              operationalOwnerId: attempt.owner_id,
              financialOwnerId: this.isPlatformBillingAttempt(attempt) ? this.hmsFinancialOwnerId() : attempt.owner_id,
              hostelId: this.isPlatformBillingAttempt(attempt) ? null : attempt.hostel_id,
            });
          }
        } else {
          const fresh = await prisma.paymentAttempt.findUnique({ where: { id: attempt.id } });
          if (fresh) {
            activeAttempt = fresh;
          }
        }
      }

      let fetched;
      try {
        fetched = await instance.fetchStatus(
          (activeAttempt as any).merchant_transaction_id || activeAttempt.merchant_txn_id,
          razorpay_order_id
        );
        await paymentProviderVerificationSnapshotService.record({
          provider: "RAZORPAY",
          source: "VERIFY",
          attempt: activeAttempt,
          providerTransactionId: razorpay_payment_id,
          providerOrderId: razorpay_order_id,
          providerReferenceId: razorpay_payment_id,
          providerStatus: (fetched as any).provider_status || fetched.status,
          normalizedStatus: fetched.status,
          amount: (fetched as any).amount ?? null,
          rawResponse: fetched.raw_status,
        });
      } catch (error) {
        logger.error("payments.verify.razorpay_fetch_status_failed", {
          attemptId: activeAttempt.id,
          merchantTxnId: activeAttempt.merchant_txn_id,
          provider: activeAttempt.provider,
          error: String(error),
        });

        return {
          attempt: this.mapAttemptWithRawResponse(activeAttempt),
          status: activeAttempt.status,
          source: "cached_pending"
        };
      }

      logger.info("payments.verify.razorpay_fetched_status", {
        attemptId: activeAttempt.id,
        merchantTxnId: activeAttempt.merchant_txn_id,
        fromStatus: activeAttempt.status,
        fetchedStatus: fetched.status,
      });

      if (fetched.status === "PENDING") {
        return {
          attempt: this.mapAttemptWithRawResponse(activeAttempt),
          status: activeAttempt.status,
          source: "pending"
        };
      }

      const finalized = await this.finalizePaymentAttempt(
        activeAttempt.id,
        fetched.status,
        fetched.provider_transaction_id || fetched.gateway_txn_id || razorpay_payment_id || undefined,
        { source: "verify", payload: fetched.raw_status }
      );

      const resolvedAttempt = finalized || activeAttempt;

      return {
        attempt: this.mapAttemptWithRawResponse(resolvedAttempt),
        status: resolvedAttempt.status,
        source: "provider"
      };
    }

    let resolvedGatewayTxnId = gatewayTxnId || (attempt as any).provider_order_id || attempt.gateway_txn_id || undefined;

    let fetched;

    try {
      fetched = await instance.fetchStatus(
        (attempt as any).merchant_transaction_id || attempt.merchant_txn_id,
        resolvedGatewayTxnId
      );
      await paymentProviderVerificationSnapshotService.record({
        provider: attempt.provider,
        source: "VERIFY",
        attempt,
        providerTransactionId: fetched.provider_transaction_id || null,
        providerOrderId: fetched.provider_order_id || fetched.gateway_txn_id || null,
        providerReferenceId: fetched.provider_reference_id || null,
        providerStatus: (fetched as any).provider_status || fetched.status,
        normalizedStatus: fetched.status,
        amount: (fetched as any).amount ?? null,
        rawResponse: fetched.raw_status,
      });
    } catch (error) {
      logger.error("payments.verify.fetch_status_failed", {
        attemptId: attempt.id,
        merchantTxnId: attempt.merchant_txn_id,
        provider: attempt.provider,
        error: String(error),
      });

      return {
        attempt: this.mapAttemptWithRawResponse(attempt),
        status: attempt.status,
        source: "cached_pending"
      };
    }

    logger.info("payments.verify.fetched_status", {
      attemptId: attempt.id,
      merchantTxnId: attempt.merchant_txn_id,
      fromStatus: attempt.status,
      fetchedStatus: fetched.status,
      provider: attempt.provider,
    });

    // Skip finalize when provider says PENDING — no state change needed, avoids
    // a no-op DB write on every poll while payment is in-flight.
    if (fetched.status === "PENDING") {
      return { attempt: this.mapAttemptWithRawResponse(attempt), status: attempt.status, source: "pending" };
    }

    const finalized = await this.finalizePaymentAttempt(
      attempt.id,
      fetched.status,
      fetched.provider_transaction_id || fetched.gateway_txn_id || undefined,
      { source: "verify", payload: fetched.raw_status }
    );

    const resolvedAttempt = finalized || attempt;

    return {
      attempt: this.mapAttemptWithRawResponse(resolvedAttempt),
      status: resolvedAttempt.status,
      source: "provider"
    };
  }

  /**
   * @deprecated Only caller is scripts/correct-shreyan-deposit.ts (a one-off
   * ops script). No route uses this — app/api/payments/obligations/[id]/waive
   * calls obligationEngine.waiveObligationInTx directly. Delegates to that
   * same canonical implementation. Return shape (bare obligation record) is
   * preserved for the script.
   */
  async waiveObligation(obligationId: string, userId: string, reason = "Manual waiver by owner") {
    return prisma.$transaction(async (tx: any) => {
      const result = await obligationEngine.waiveObligationInTx(tx, {
        obligationId,
        reason,
        actorId: userId,
      });
      return result.obligation;
    }).then(async (obligation: any) => {
      await eventSystem.trigger("rent_waived", { obligationId, userId });
      return obligation;
    });
  }

  async getDuesReport(ownerId: string, hostelId: string, rentMonth?: Date, status?: string) {
    const dues = await paymentRepository.getDuesReportData(ownerId, hostelId, rentMonth, status);

    return dues.map((d: any) => ({
      obligation_id: d.id,
      tenant_id: d.tenant_id,
      hostel_id: d.hostel_id,
      tenant_name: d.tenants?.profiles?.name || "Tenant",
      tenant_email: d.tenants?.profiles?.email || "",
      tenant_phone: d.tenants?.profiles?.phone || "",
      photo_url: d.tenants?.photo_url || null,
      room_no: d.room_allocations?.room?.room_no || "N/A",
      rent_month: d.rent_month,
      due_date: d.due_date,
      amount: Number(d.total_amount || d.amount),
      late_fee: Number(d.late_fee || 0),
      obligation_type: d.obligation_type || "RENT",
      status: d.status,
      outstanding: Math.max(0, Number(d.total_amount || d.amount) - (d.payments?.reduce((s: number, p: any) => s + Number(p.amount_paid), 0) || 0))
    }));
  }

  async getAllPayments(
    ownerId: string,
    hostelId: string,
    limit: number = 50,
    offset: number = 0,
    filters?: {
      tenantId?: string;
      status?: string;
      method?: string;
      month?: string;
    }
  ) {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const statusFilter = (filters?.status || "").toUpperCase();

    const methodFilter = filters?.method
      ? Prisma.sql`AND p.payment_method = ${filters.method}`
      : Prisma.empty;
    const monthFilter = typeof filters?.month === "string" && /^\d{4}-\d{2}$/.test(filters.month)
      ? Prisma.sql`AND o.rent_month >= ${new Date(`${filters.month}-01T00:00:00.000Z`)}::date
          AND o.rent_month < ${new Date(Date.UTC(Number(filters.month.slice(0, 4)), Number(filters.month.slice(5, 7)), 1, 0, 0, 0, 0))}::date`
      : Prisma.empty;
    const tenantFilter = filters?.tenantId
      ? Prisma.sql`AND o.tenant_id = ${filters.tenantId}::uuid`
      : Prisma.empty;

    const statusWhere =
      !statusFilter || statusFilter === "ALL"
        ? Prisma.sql`TRUE`
        : statusFilter === "PAID"
          ? Prisma.sql`computed_status = 'paid'`
          : statusFilter === "PENDING"
            ? Prisma.sql`computed_status IN ('pending', 'partial')`
            : statusFilter === "OVERDUE"
              ? Prisma.sql`computed_status = 'overdue'`
              : statusFilter === "PARTIAL"
                ? Prisma.sql`computed_status = 'partial'`
                : statusFilter === "WAIVED"
                  ? Prisma.sql`computed_status = 'waived'`
                  : Prisma.sql`UPPER(computed_status) = ${statusFilter}`;

    const rows = await prisma.$queryRaw<any[]>`
      WITH hostel_scope AS (
        SELECT EXISTS (
          SELECT 1
          FROM hostels h
          WHERE h.id = ${hostelId}::uuid
            AND h.owner_id = ${ownerId}::uuid
        ) AS allowed
      ),
      base AS (
        SELECT
          o.id,
          o.tenant_id,
          o.rent_month,
          o.due_date,
          o.amount::float AS base_rent_amount,
          o.late_fee::float AS late_fee,
          o.total_amount::float AS rent_amount,
          o.obligation_type::text AS obligation_type,
          o.status::text AS status_raw,
          COALESCE(pay.total_paid, 0)::float AS paid_amount,
          GREATEST(0, o.total_amount::float - COALESCE(pay.total_paid, 0))::float AS balance,
          COALESCE(pay.payment_methods, '[]'::jsonb) AS payment_methods,
          prof.name AS tenant_name,
          prof.phone AS tenant_phone,
          prof.email AS tenant_email,
          r.room_no,
          latest.id AS latest_payment_id,
          latest.payment_method AS latest_payment_method,
          latest.reference_number AS latest_reference_number,
          latest.created_at AS latest_created_at,
          latest.payment_date AS latest_payment_date,
          latest_attempt.provider AS latest_attempt_provider,
          latest_attempt.provider_order_id AS latest_attempt_provider_order_id,
          latest_attempt.provider_transaction_id AS latest_attempt_provider_transaction_id,
          latest_attempt.status AS latest_attempt_status,
          latest_attempt.confirmed_at AS latest_attempt_confirmed_at,
          latest_attempt.settled_at AS latest_attempt_settled_at,
          latest_attempt.created_at AS latest_attempt_created_at,
          CASE
            WHEN o.status::text = 'WAIVED' THEN 'waived'
            WHEN o.status::text = 'PAID' OR o.total_amount::float - COALESCE(pay.total_paid, 0) <= 0 THEN 'paid'
            WHEN latest_attempt.status::text = 'PENDING_VERIFICATION' THEN 'pending_verification'
            WHEN latest_attempt.status::text = 'PROCESSING' THEN 'processing'
            WHEN o.due_date < ${todayUTC}::date THEN 'overdue'
            WHEN o.status::text = 'PARTIAL' THEN 'partial'
            ELSE 'pending'
          END AS computed_status
        FROM rent_obligations o
        JOIN hostel_scope hs ON hs.allowed
        LEFT JOIN tenants t ON t.id = o.tenant_id
        LEFT JOIN profiles prof ON prof.id = t.profile_id
        LEFT JOIN room_allocations ra ON ra.id = o.allocation_id
        LEFT JOIN rooms r ON r.id = ra.room_id
        LEFT JOIN LATERAL (
          SELECT
            SUM(p.amount_paid)::float AS total_paid,
            COALESCE(jsonb_agg(DISTINCT p.payment_method) FILTER (WHERE p.payment_method IS NOT NULL), '[]'::jsonb) AS payment_methods
          FROM payments p
          WHERE p.obligation_id = o.id
          ${methodFilter}
        ) pay ON true
        LEFT JOIN LATERAL (
          SELECT p.id, p.payment_method, p.reference_number, p.created_at, p.payment_date
          FROM payments p
          WHERE p.obligation_id = o.id
          ${methodFilter}
          ORDER BY p.payment_date DESC, p.created_at DESC
          LIMIT 1
        ) latest ON true
        LEFT JOIN LATERAL (
          SELECT
            pa.provider,
            pa.provider_order_id,
            pa.provider_transaction_id,
            pa.status::text AS status,
            pa.confirmed_at,
            pa.settled_at,
            pa.created_at
          FROM payment_attempts pa
          LEFT JOIN payment_attempt_obligations pao ON pao.payment_attempt_id = pa.id
          WHERE pa.obligation_id = o.id OR pao.obligation_id = o.id
          ORDER BY pa.created_at DESC
          LIMIT 1
        ) latest_attempt ON true
        WHERE o.owner_id = ${ownerId}::uuid
          AND o.hostel_id = ${hostelId}::uuid
          AND o.status::text != 'WAIVED'
          ${tenantFilter}
          ${monthFilter}
      ),
      filtered AS (
        SELECT *
        FROM base
        WHERE ${statusWhere}
      ),
      paged AS (
        SELECT *
        FROM filtered
        ORDER BY rent_month DESC NULLS LAST, due_date DESC NULLS LAST
        LIMIT ${limit}
        OFFSET ${offset}
      ),
      stats AS (
        SELECT
          COUNT(*)::int AS total,
          COALESCE(SUM(paid_amount), 0)::float AS total_collected,
          COUNT(*) FILTER (WHERE computed_status IN ('pending', 'partial', 'overdue', 'pending_verification', 'processing'))::int AS pending_rows,
          COUNT(*) FILTER (WHERE computed_status = 'overdue')::int AS overdue_rows
        FROM filtered
      ),
      operational_dues AS (
        SELECT
          COALESCE(SUM(
            o.total_amount - COALESCE(pay_agg.total_paid, 0)
          ), 0)::float AS pending_total,
          COALESCE(SUM(
            CASE WHEN o.due_date < ${todayUTC}::date
              THEN o.total_amount - COALESCE(pay_agg.total_paid, 0)
              ELSE 0
            END
          ), 0)::float AS overdue_total
        FROM rent_obligations o
        JOIN hostel_scope hs ON hs.allowed
        JOIN tenants t ON t.id = o.tenant_id
        LEFT JOIN (
          SELECT obligation_id, SUM(amount_paid)::float AS total_paid
          FROM payments
          GROUP BY obligation_id
        ) pay_agg ON pay_agg.obligation_id = o.id
        WHERE o.owner_id = ${ownerId}::uuid
          AND o.hostel_id = ${hostelId}::uuid
          AND o.status IN ('PENDING', 'PARTIAL', 'UPCOMING')
          AND t.status = 'ACTIVE'
          AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
      ),
      active_tenants AS (
        SELECT COUNT(*)::int AS active_tenants
        FROM tenants t
        WHERE t.owner_id = ${ownerId}::uuid
          AND t.hostel_id = ${hostelId}::uuid
          AND t.status = 'ACTIVE'
      ),
      payment_records AS (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', p.id,
          'obligationId', f.id,
          'tenantId', f.tenant_id,
          'tenantName', COALESCE(f.tenant_name, 'Unknown'),
          'amount', p.amount_paid::float,
          'month', f.rent_month,
          'date', p.payment_date,
          'paymentDate', p.payment_date,
          'createdAt', p.created_at,
          'method', p.payment_method,
          'status', 'paid',
          'paymentAttemptProvider', pa.provider,
          'paymentAttemptGatewayTxnId', COALESCE(pa.provider_transaction_id, pa.provider_order_id),
          'paymentAttemptStatus', pa.status,
          'paymentAttemptSettledAt', pa.settled_at,
          'paymentAttemptConfirmedAt', pa.confirmed_at,
          'paymentAttemptCreatedAt', pa.created_at
        ) ORDER BY p.payment_date DESC, p.created_at DESC), '[]'::jsonb) AS rows
        FROM filtered f
        JOIN payments p ON p.obligation_id = f.id
        LEFT JOIN payment_attempts pa ON p.payment_attempt_id = pa.id
        ${filters?.method ? Prisma.sql`WHERE p.payment_method = ${filters.method}` : Prisma.empty}
      ),
      page_rows AS (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', id,
          'obligationId', id,
          'tenantId', tenant_id,
          'tenantName', COALESCE(tenant_name, 'Unknown'),
          'tenant_name', COALESCE(tenant_name, 'Unknown'),
          'tenantPhone', tenant_phone,
          'tenantEmail', tenant_email,
          'room', COALESCE(room_no, 'N/A'),
          'room_no', COALESCE(room_no, 'N/A'),
          'month', rent_month,
          'dueDate', due_date,
          'rentAmount', rent_amount,
          'baseAmount', base_rent_amount,
          'lateFee', late_fee,
          'obligationType', obligation_type,
          'paidAmount', paid_amount,
          'amount_paid', paid_amount,
          'balance', balance,
          'outstanding', balance,
          'status', computed_status,
          'statusRaw', UPPER(status_raw),
          'paymentMethod', latest_payment_method,
          'paymentMethods', payment_methods,
          'latestPaymentId', latest_payment_id,
          'reference_number', latest_reference_number,
          'preferred_app', null,
          'createdAt', latest_created_at,
          'paymentDate', latest_payment_date,
          'payment_date', latest_payment_date,
          'isReceiptAvailable', latest_payment_id IS NOT NULL,
          'entityType', 'ledger',
          'amount', CASE WHEN balance > 0 THEN balance ELSE COALESCE(NULLIF(paid_amount, 0), rent_amount) END,
          'paymentAttemptProvider', latest_attempt_provider,
          'paymentAttemptGatewayTxnId', COALESCE(latest_attempt_provider_transaction_id, latest_attempt_provider_order_id),
          'paymentAttemptStatus', latest_attempt_status,
          'paymentAttemptSettledAt', latest_attempt_settled_at,
          'paymentAttemptConfirmedAt', latest_attempt_confirmed_at,
          'paymentAttemptCreatedAt', latest_attempt_created_at
        ) ORDER BY rent_month DESC NULLS LAST, due_date DESC NULLS LAST), '[]'::jsonb) AS rows
        FROM paged
      )
      SELECT
        hs.allowed,
        s.total,
        s.total_collected,
        od.pending_total AS pending_dues,
        od.overdue_total AS overdue_amount,
        s.pending_rows,
        s.overdue_rows,
        a.active_tenants,
        pr.rows AS payment_records,
        page.rows AS payments
      FROM hostel_scope hs
      CROSS JOIN stats s
      CROSS JOIN operational_dues od
      CROSS JOIN active_tenants a
      CROSS JOIN payment_records pr
      CROSS JOIN page_rows page
    `;

    const row = rows[0] || {};
    if (!row.allowed) {
      const error = new Error("Hostel is not owned by the authenticated owner.");
      (error as any).code = "FORBIDDEN";
      throw error;
    }

    const paginatedRows = Array.isArray(row.payments) ? row.payments : [];
    const paymentRecords = Array.isArray(row.payment_records) ? row.payment_records : [];
    const total = Number(row.total || 0);
    const stats = {
      total_collected: Number(Number(row.total_collected || 0).toFixed(2)),
      pending_dues: Number(Number(row.pending_dues || 0).toFixed(2)),
      overdue_amount: Number(Number(row.overdue_amount || 0).toFixed(2)),
      active_tenants: Number(row.active_tenants || 0),
      pending_rows: Number(row.pending_rows || 0),
      overdue_rows: Number(row.overdue_rows || 0),
    };

    return {
      stats,
      payments: paginatedRows,
      payment_records: paymentRecords,
      total,
      limit,
      offset,
    };
  }

  private async getExistingPaidAmount(obligationId: string): Promise<number> {
    const payments = await prisma.payments.findMany({
      where: { obligation_id: obligationId },
      select: { amount_paid: true }
    });
    return payments.reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
  }


  private getOwnerLevelProviderConfig() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error("CONFIG_ERROR: Razorpay key and secret are not configured");
    }
    return {
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
      webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
      base_url: process.env.RAZORPAY_BASE_URL || "https://api.razorpay.com",
      callbackUrl: backendUrl("/api/webhooks/payments/razorpay"),
    };
  }

  async getTenantPaymentHistory(tenantId: string) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: {
        room_allocations: {
          where: { is_active: true, end_date: null },
          include: { room: true },
          orderBy: { created_at: "desc" }
        },
        rent_obligations: {
          orderBy: { due_date: "desc" },
          include: {
            payments: {
              orderBy: { payment_date: "desc" }
            }
          }
        }
      }
    });

    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");

    if (!tenant.hostel_id) throw new Error("HOSTEL_CONTEXT_REQUIRED: tenant hostel scope unavailable");
    const dues = await financialService.getTenantDues(tenantId, tenant.owner_id || undefined, tenant.hostel_id);
    let totalDue = dues.total_due;
    let totalPaid = 0;
    const allPayments: any[] = [];
    const latestUnpaidDueDate = dues.items[0]?.due_date || null;

    const formattedObligations = (tenant as any).rent_obligations.map((o: any) => {
      const obligationPaid = o.payments.reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);
      const remainingDue = Math.max(0, Number(o.amount) - obligationPaid);

      totalPaid += obligationPaid;
      o.payments.forEach((p: any) => {
        const transactionId = p.reference_number || p.payment_attempt_id || p.id;
        const reversal = describePaymentReversal(p);
        allPayments.push({
          id: p.id,
          obligation_id: p.obligation_id,
          amount_paid: Number(p.amount_paid),
          payment_date: p.payment_date,
          payment_method: p.payment_method,
          payment_method_label: paymentMethodLabel(p.payment_method),
          is_reversal: reversal.isReversal,
          reference_number: p.reference_number,
          transaction_id: transactionId,
          rent_month: o.rent_month
        });
      });

      return {
        id: o.id,
        rent_month: o.rent_month,
        due_date: o.due_date,
        amount: Number(o.amount),
        obligation_type: o.obligation_type,
        status: o.status,
        remaining_due: o.status === "WAIVED" ? 0 : remainingDue,
        payments: o.payments.map((p: any) => ({
          id: p.id,
          amount_paid: Number(p.amount_paid),
          payment_date: p.payment_date,
          method: p.payment_method,
          method_label: paymentMethodLabel(p.payment_method),
          is_reversal: describePaymentReversal(p).isReversal,
          transaction_id: p.reference_number || p.payment_attempt_id || p.id
        }))
      };
    });

    const outstandingBalance = dues.total_due;
    const paymentStatus = outstandingBalance <= 0
      ? "PAID"
      : totalPaid > 0
        ? "PARTIAL"
        : "PENDING";
    const allocationRent = Number((tenant as any).room_allocations?.[0]?.room?.base_rent || 0);
    const fallbackObligationRent = Number((tenant as any).rent_obligations?.[0]?.amount || 0);
    const tenantRent = Number(tenant.monthly_rent || 0);
    const monthlyRent =
      (allocationRent > 0 ? allocationRent : 0) ||
      (tenantRent > 0 ? tenantRent : 0) ||
      (fallbackObligationRent > 0 ? fallbackObligationRent : 0);

    return {
      tenant_id: tenantId,
      obligations: formattedObligations,
      payments: allPayments.sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()),
      monthly_rent: monthlyRent,
      next_due_date: latestUnpaidDueDate,
      payment_status: paymentStatus,
      total_due: totalDue,
      total_paid: totalPaid,
      outstanding_balance: outstandingBalance,
      // Due-date-gated figure — do NOT confuse with outstanding_balance
      // (all outstanding, any due date, unchanged above).
      overdue_balance: dues.overdue_amount,
      current_payable_amount: dues.current_payable_amount,
      upcoming_amount: dues.upcoming_amount,
    };
  }

  async reconcilePendingAttempts(options?: {
    ownerId?: string;
    hostelId?: MaybeHostelId;
    paymentDomain?: string;
    attemptIds?: string[];
  }) {
    const now = new Date();
    const ownerFilter = options?.ownerId ? { owner_id: options.ownerId } : {};
    const hostelFilter = options?.hostelId ? { hostel_id: options.hostelId } : {};
    const domainFilter = options?.paymentDomain ? { payment_domain: options.paymentDomain } : {};
    const idFilter = options?.attemptIds?.length
      ? { OR: [
          { id: { in: options.attemptIds } },
          { merchant_txn_id: { in: options.attemptIds } },
          { merchant_transaction_id: { in: options.attemptIds } },
          { gateway_txn_id: { in: options.attemptIds } },
          { provider_transaction_id: { in: options.attemptIds } },
          { provider_order_id: { in: options.attemptIds } },
          { provider_reference_id: { in: options.attemptIds } },
        ] }
      : {};
    const run = await (prisma as any).paymentReconciliationRun.create({
      data: {
        id: crypto.randomUUID(),
        payment_domain: options?.paymentDomain || (options?.hostelId ? PAYMENT_DOMAIN.RENT_COLLECTION : PAYMENT_DOMAIN.PLATFORM_BILLING),
        scope_type: options?.hostelId ? PAYMENT_SCOPE.HOSTEL : PAYMENT_SCOPE.PLATFORM,
        operational_owner_id: options?.ownerId || null,
        financial_owner_id: (options?.paymentDomain === PAYMENT_DOMAIN.PLATFORM_BILLING || (!options?.hostelId && !options?.ownerId))
          ? this.hmsFinancialOwnerId()
          : options?.ownerId || null,
        hostel_id: options?.hostelId || null,
      },
    });
    const createItem = async (data: any) => {
      await (prisma as any).paymentReconciliationItem.create({
        data: {
          id: crypto.randomUUID(),
          reconciliation_run_id: run.id,
          ...data,
          operational_owner_id: options?.ownerId || data.operational_owner_id || null,
          financial_owner_id: options?.paymentDomain === PAYMENT_DOMAIN.PLATFORM_BILLING
            ? this.hmsFinancialOwnerId()
            : options?.ownerId || data.financial_owner_id || null,
          hostel_id: options?.hostelId || data.hostel_id || null,
        },
      }).catch((error: any) => logger.warn("payments.reconcile.item_failed", { run_id: run.id, error: String(error) }));
    };

    // ── Pass 0: Release stale PROCESSING / PENDING_VERIFICATION locks ──────────
    // If a server crashed while holding PROCESSING (or while PENDING_VERIFICATION
    // was set by the webhook handler), the attempt is stuck and no future webhook
    // will ever pick it up. Recovery SLA: 5 minutes.
    //
    //   PENDING_VERIFICATION > 5 min → reset to PENDING
    //     (webhook verification / provider API call likely crashed before completing)
    //
    //   PROCESSING > 5 min, payments already committed → mark SUCCESS
    //     (the payment TX committed but the status update crashed afterward)
    //
    //   PROCESSING > 5 min, no payments → reset to PENDING
    //     (the payment TX never committed; normal reconciliation will retry)
    const staleLockCutoff = new Date(now.getTime() - 5 * 60 * 1000);

    const stalePendingVerificationList = await prisma.paymentAttempt.findMany({
      where: { status: "PENDING_VERIFICATION", updated_at: { lt: staleLockCutoff }, ...ownerFilter, ...hostelFilter, ...domainFilter, ...idFilter },
    });
    let stalePendingVerificationReset = 0;
    for (const stale of stalePendingVerificationList) {
      await this.updateAttemptStatusOutsideTx({
        attemptId: stale.id,
        fromStatus: "PENDING_VERIFICATION",
        toStatus: "PENDING",
        source: "RECONCILE",
          reason: "stale provider verification lock reset",
          operationalOwnerId: stale.owner_id,
          financialOwnerId: this.isPlatformBillingAttempt(stale) ? this.hmsFinancialOwnerId() : stale.owner_id,
          hostelId: this.isPlatformBillingAttempt(stale) ? null : stale.hostel_id,
      }).then(() => { stalePendingVerificationReset++; }).catch(() => {});
      await createItem({
        payment_attempt_id: stale.id,
        anomaly_type: "STALE_PENDING_VERIFICATION",
        severity: "MEDIUM",
        action: "RESET_TO_PENDING",
        result: "REPAIRED",
        metadata: { merchant_transaction_id: (stale as any).merchant_transaction_id || stale.merchant_txn_id },
      });
    }

    const staleProcessingList = await prisma.paymentAttempt.findMany({
      where: { status: "PROCESSING", updated_at: { lt: staleLockCutoff }, ...ownerFilter, ...hostelFilter, ...domainFilter, ...idFilter },
      include: { payments: { select: { id: true } } },
    });

    let staleProcessingRecovered = 0;
    let staleProcessingReset = 0;
    for (const stale of staleProcessingList) {
      if ((stale as any).payments.length > 0) {
        await this.updateAttemptStatusOutsideTx({
          attemptId: stale.id,
          fromStatus: "PROCESSING",
          toStatus: "SUCCESS",
          source: "RECONCILE",
          reason: "stale processing recovered because ledger exists",
          operationalOwnerId: stale.owner_id,
          financialOwnerId: this.isPlatformBillingAttempt(stale) ? this.hmsFinancialOwnerId() : stale.owner_id,
          hostelId: this.isPlatformBillingAttempt(stale) ? null : stale.hostel_id,
          data: { settlement_status: SETTLEMENT_STATUS.SETTLED, settled_at: new Date() },
        }).catch(() => {});
        staleProcessingRecovered++;
        await createItem({ payment_attempt_id: stale.id, anomaly_type: "STALE_PROCESSING", severity: "HIGH", action: "MARK_SUCCESS_WITH_EXISTING_LEDGER", result: "REPAIRED" });
        logger.warn("payments.reconcile.stale_processing_recovered", {
          attempt_id: stale.id, merchant_txn_id: stale.merchant_txn_id,
          payment_count: (stale as any).payments.length,
        });
      } else {
        await this.updateAttemptStatusOutsideTx({
          attemptId: stale.id,
          fromStatus: "PROCESSING",
          toStatus: "PENDING",
          source: "RECONCILE",
          reason: "stale processing without ledger reset",
          operationalOwnerId: stale.owner_id,
          financialOwnerId: this.isPlatformBillingAttempt(stale) ? this.hmsFinancialOwnerId() : stale.owner_id,
          hostelId: this.isPlatformBillingAttempt(stale) ? null : stale.hostel_id,
        }).catch(() => {});
        staleProcessingReset++;
        await createItem({ payment_attempt_id: stale.id, anomaly_type: "STALE_PROCESSING", severity: "MEDIUM", action: "RESET_TO_PENDING", result: "REPAIRED" });
        logger.warn("payments.reconcile.stale_processing_reset", {
          attempt_id: stale.id, merchant_txn_id: stale.merchant_txn_id,
        });
      }
    }

    logger.info("payments.reconcile.stale_lock_sweep", {
      pending_verification_reset: stalePendingVerificationReset,
      processing_recovered: staleProcessingRecovered,
      processing_reset: staleProcessingReset,
    });

    // ── Pass 1: Auto-expire stale CREATED attempts (no provider call needed) ──
    // CREATED = PaymentAttempt was inserted but gateway call never returned / crashed.
    // 10-minute grace window; anything older is a ghost attempt.
    const staleCreatedCutoff = new Date(now.getTime() - 10 * 60 * 1000);
    const staleCreatedList = await prisma.paymentAttempt.findMany({
      where: { status: "CREATED", created_at: { lt: staleCreatedCutoff }, ...ownerFilter, ...hostelFilter, ...domainFilter, ...idFilter },
    });
    let staleCreatedExpired = 0;
    for (const stale of staleCreatedList) {
      await this.updateAttemptStatusOutsideTx({
        attemptId: stale.id,
        fromStatus: "CREATED",
        toStatus: "EXPIRED",
        source: "RECONCILE",
        reason: "stale created attempt expired",
        operationalOwnerId: stale.owner_id,
        financialOwnerId: this.isPlatformBillingAttempt(stale) ? this.hmsFinancialOwnerId() : stale.owner_id,
        hostelId: this.isPlatformBillingAttempt(stale) ? null : stale.hostel_id,
        data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
      }).then(() => { staleCreatedExpired++; }).catch(() => {});
      await createItem({ payment_attempt_id: stale.id, anomaly_type: "STALE_CREATED", severity: "LOW", action: "EXPIRE", result: "REPAIRED" });
    }

    // ── Pass 2: Auto-expire PENDING attempts past their expires_at ──
    // These are gateway-issued expiry times. Proactively mark EXPIRED without
    // hitting the provider API — the gateway already considers them invalid.
    const autoExpireList = await prisma.paymentAttempt.findMany({
      where: { status: "PENDING", expires_at: { lt: now }, ...ownerFilter, ...hostelFilter, ...domainFilter, ...idFilter },
    });
    let autoExpired = 0;
    for (const stale of autoExpireList) {
      await this.updateAttemptStatusOutsideTx({
        attemptId: stale.id,
        fromStatus: "PENDING",
        toStatus: "EXPIRED",
        source: "RECONCILE",
        reason: "attempt expired by gateway expiry",
        operationalOwnerId: stale.owner_id,
        financialOwnerId: this.isPlatformBillingAttempt(stale) ? this.hmsFinancialOwnerId() : stale.owner_id,
        hostelId: this.isPlatformBillingAttempt(stale) ? null : stale.hostel_id,
        data: { settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE },
      }).then(() => { autoExpired++; }).catch(() => {});
      await createItem({ payment_attempt_id: stale.id, anomaly_type: "STALE_PENDING", severity: "LOW", action: "EXPIRE", result: "REPAIRED" });
    }

    logger.info("payments.reconcile.sweep", {
      stale_created_expired: staleCreatedExpired,
      auto_expired_by_expiry: autoExpired,
    });

    const orphanSuccessList = await prisma.paymentAttempt.findMany({
      where: {
        status: "SUCCESS",
        OR: [{ payment_domain: PAYMENT_DOMAIN.RENT_COLLECTION }, { payment_domain: null }],
        flow_type: { notIn: [PAYMENT_FLOW.ADDON, PAYMENT_FLOW.SUBSCRIPTION, PAYMENT_FLOW.ADVANCE, PAYMENT_FLOW.DEPOSIT, PAYMENT_FLOW.FUTURE_RENT_CREDIT, PAYMENT_FLOW.SECURITY_DEPOSIT] },
        ...ownerFilter,
        ...hostelFilter,
        ...domainFilter,
        ...idFilter,
      },
      include: { payments: { select: { id: true } } },
    });
    let orphanSuccess = 0;
    for (const orphan of orphanSuccessList) {
      if ((orphan as any).payments.length > 0) continue;
      orphanSuccess++;
      await paymentOperationalAnomalyService.create({
        anomalyType: "ORPHAN_SUCCESS",
        severity: "CRITICAL",
        paymentDomain: (orphan as any).payment_domain || PAYMENT_DOMAIN.RENT_COLLECTION,
        flowType: (orphan as any).flow_type || PAYMENT_FLOW.RENT,
        paymentAttemptId: orphan.id,
        reconciliationRunId: run.id,
        operationalOwnerId: orphan.owner_id,
        financialOwnerId: orphan.owner_id,
        hostelId: orphan.hostel_id,
        metadata: { merchant_transaction_id: (orphan as any).merchant_transaction_id || orphan.merchant_txn_id },
      });
      await createItem({
        payment_attempt_id: orphan.id,
        anomaly_type: "ORPHAN_SUCCESS",
        severity: "CRITICAL",
        action: "DETECT_ONLY",
        result: "MANUAL_REVIEW_REQUIRED",
        operational_owner_id: orphan.owner_id,
        financial_owner_id: orphan.owner_id,
        hostel_id: orphan.hostel_id,
      });
    }

    // ── Pass 3: Query provider for remaining PENDING attempts (48h window) ──
    // 48h instead of 24h to catch delayed webhook delivery on flaky connections.
    //
    // BACKOFF: Only reconcile attempts that are at least 15 minutes old.
    // Anything younger should be resolved by a webhook or the tenant's verify
    // poll — hitting the provider API immediately wastes quota and races with
    // in-flight webhooks. Operator-supplied IDs bypass this floor so support
    // engineers can force-reconcile a specific attempt at any time.
    const pendingCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const backoffFloor = options?.attemptIds?.length
      ? new Date(now.getTime() + 24 * 60 * 60 * 1000)    // no floor for explicit IDs (include future to be safe)
      : new Date(now.getTime() - 15 * 60 * 1000);      // 15-minute floor for sweeps
    const pending = await prisma.paymentAttempt.findMany({
      where: {
        status: { in: ["PENDING", "PENDING_VERIFICATION"] },
        created_at: { gte: pendingCutoff, lt: backoffFloor },
        ...ownerFilter,
        ...hostelFilter,
        ...domainFilter,
        ...idFilter,
      }
    });

    let success = 0;
    let failed = 0;
    let pendingCount = 0;
    let expired = 0;
    let cancelled = 0;
    let errors = 0;

    // Cache provider instances by owner + hostel + provider so multi-hostel owners
    // cannot reconcile one hostel through another hostel's merchant context.
    const providerCache = new Map<string, any>();

    for (const attempt of pending) {
      try {
        const attemptHostelId = this.isPlatformBillingAttempt(attempt)
          ? null
          : requireFinancialHostelId(attempt.hostel_id, "payment reconciliation");
        const cacheKey = [attempt.owner_id, (attempt as any).payment_domain || "LEGACY", attemptHostelId || "platform", attempt.provider].join(":");
        let instance = providerCache.get(cacheKey);
        if (!instance) {
          const pi = await this.getProviderInstanceForAttempt(attempt, "payment reconciliation");
          instance = pi.instance;
          providerCache.set(cacheKey, instance);
        }

        const fetched = await instance.fetchStatus(
          (attempt as any).merchant_transaction_id || attempt.merchant_txn_id,
          (attempt as any).provider_order_id || attempt.gateway_txn_id || undefined
        );
        await paymentProviderVerificationSnapshotService.record({
          provider: attempt.provider,
          source: "RECONCILE",
          attempt,
          reconciliationRunId: run.id,
          providerTransactionId: fetched.provider_transaction_id || null,
          providerOrderId: fetched.provider_order_id || fetched.gateway_txn_id || null,
          providerReferenceId: fetched.provider_reference_id || null,
          providerStatus: (fetched as any).provider_status || fetched.status,
          normalizedStatus: fetched.status,
          amount: (fetched as any).amount ?? null,
          rawResponse: fetched.raw_status,
        });

        // If the provider still says PENDING but expires_at has now passed
        // (may have just crossed the boundary during this reconcile run)
        let nextStatus = fetched.status;
        if (nextStatus === "PENDING" && attempt.expires_at && attempt.expires_at < now) {
          nextStatus = "EXPIRED";
        }

        const finalized = await this.finalizePaymentAttempt(
          attempt.id,
          nextStatus,
          fetched.provider_transaction_id || fetched.gateway_txn_id || undefined,
          { source: "reconcile", payload: fetched.raw_status }
        );

        const resolvedAttempt = finalized || attempt;

        if (resolvedAttempt.status === "SUCCESS") success++;
        else if (resolvedAttempt.status === "FAILED") failed++;
        else if (resolvedAttempt.status === "EXPIRED") expired++;
        else if (resolvedAttempt.status === "CANCELLED") cancelled++;
        else pendingCount++;
      } catch (error) {
        errors++;
        logger.error("payments.reconcile.failed", {
          attemptId: attempt.id,
          merchantTxnId: attempt.merchant_txn_id,
          error: String(error),
        });
      }
    }

    const summary = {
      processed: pending.length,
      stale_pending_verification_reset: stalePendingVerificationReset,
      stale_processing_recovered: staleProcessingRecovered,
      stale_processing_reset: staleProcessingReset,
      stale_created_expired: staleCreatedExpired,
      auto_expired: autoExpired,
      orphan_success: orphanSuccess,
      success,
      failed,
      pending: pendingCount,
      expired,
      cancelled,
      errors,
    };
    await (prisma as any).paymentReconciliationRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", completed_at: new Date(), summary: summary as any },
    }).catch(() => {});
    return summary;
  }

  async getPaymentDetail(id: string, ownerId: string, hostelId: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id) || !uuidRegex.test(ownerId) || !uuidRegex.test(hostelId)) {
      throw new Error("NOT_FOUND: Obligation not found");
    }

    const payment = await prisma.payments.findFirst({
      where: { id, hostel_id: hostelId },
      select: {
        obligation_id: true,
        obligation: { select: { owner_id: true, hostel_id: true } },
      },
    });
    const paymentObligationId =
      payment?.obligation?.owner_id === ownerId && payment.obligation.hostel_id === hostelId
        ? payment.obligation_id
        : null;
    const obligationId = paymentObligationId ?? id;

    const obligation = await prisma.rent_obligations.findFirst({
      where: { id: obligationId, owner_id: ownerId, hostel_id: hostelId },
      include: {
        tenants: {
          include: {
            profiles: { select: { name: true, phone: true, email: true } },
            tenant_behavior_scores: { select: { score: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true, floor: true, room_type: true, floor_ref: { select: { name: true } } } } },
              take: 1,
            },
          },
        },
        payments: {
          orderBy: { payment_date: "desc" },
          include: { receipts: { select: { receipt_number: true } } },
        },
        reminder_logs: {
          orderBy: { sent_at: "asc" },
          select: { id: true, channel: true, sent_at: true, converted_to_payment: true, converted_at: true },
        },
      },
    });

    if (!obligation) throw new Error("NOT_FOUND: Obligation not found");

    const tenant = obligation.tenants;
    const profile = tenant?.profiles;
    const behaviorScore = tenant?.tenant_behavior_scores?.score ?? null;
    const allocation = tenant?.room_allocations?.[0];
    const room = allocation?.room;
    const floorLabel = room?.floor_ref?.name ?? (room?.floor != null ? `Floor ${room.floor}` : null);

    const totalPaid = obligation.payments.reduce((s: number, p: any) => s + Number(p.amount_paid || 0), 0);
    const totalAmount = Number(obligation.total_amount || obligation.amount || 0);
    const remaining = Math.max(0, totalAmount - totalPaid);

    return {
      id: obligation.id,
      rent_month: obligation.rent_month,
      due_date: obligation.due_date,
      status: obligation.status,
      obligation_type: obligation.obligation_type,
      total_amount: totalAmount,
      amount_paid: totalPaid,
      remaining,
      tenant: {
        id: tenant?.id ?? null,
        name: profile?.name ?? "Unknown",
        phone: profile?.phone ?? null,
        email: profile?.email ?? null,
        room_no: room?.room_no ?? "N/A",
        floor: floorLabel,
        room_type: room?.room_type ?? null,
        behavior_score: behaviorScore,
        joined_on: tenant?.joined_on ?? null,
        status: tenant?.status ?? null,
      },
      payments: obligation.payments.map((p: any) => ({
        id: p.id,
        amount_paid: Number(p.amount_paid || 0),
        payment_date: p.payment_date,
        payment_method: p.payment_method,
        reference_number: p.reference_number,
        receipt_number: p.receipts?.receipt_number ?? null,
        offline_note: p.offline_note ?? null,
        recorded_by: p.recorded_by ?? null,
        created_at: p.created_at,
      })),
      reminders: obligation.reminder_logs.map((r: any) => ({
        id: r.id,
        channel: r.channel,
        sent_at: r.sent_at,
        converted: r.converted_to_payment,
        converted_at: r.converted_at,
      })),
    };
  }
}

export const paymentService = new PaymentService();
