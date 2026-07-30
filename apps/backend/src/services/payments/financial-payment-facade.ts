/**
 * 🏦 Financial Payment Facade
 *
 * Single application-layer orchestrator for the payment domain. Centralizes
 * the "Planner → SettlementPlan → Engine" orchestration that was previously
 * either duplicated inline across route handlers, or buried as private
 * methods inside the PaymentService god-object.
 *
 * This starts as ONE orchestrator (not four separate use-case classes) per
 * the target-architecture staging decision — it can be split into dedicated
 * use cases later if responsibilities naturally diverge under real usage.
 *
 * Responsibilities:
 *   - receivePayment: execute the plan-first settlement flow inside an
 *     existing transaction (used by PaymentService's private settlement
 *     helper and by gateway finalization).
 *   - previewSettlement: read-only dry-run plan building (used by
 *     settlement-preview, settlement-plan, and create-intent's RENT-with-
 *     amount validation step).
 *
 * NOT responsibilities (still owned by PaymentService / obligation-engine):
 *   - payment-gateway integration, webhook verification, reconciliation
 *   - obligation lifecycle (create/waive/cancel) — see obligation-engine.ts
 *   - persistence details beyond what the Settlement Engine already owns
 */

import { prisma } from "@/lib/db";
import { buildSettlementPlan, toObligationSnapshot, PAYABLE_STATUSES, type SettlementPlan } from "./settlement-planner";
import { executePlanInTx, type SettlementResult } from "./settlement-engine";
import { financialPolicyEngine } from "./financial-policy-engine";
import { tenantFinancialLedgerService } from "./tenant-financial-ledger-service";

const OUTSTANDING_STATUSES: readonly string[] = PAYABLE_STATUSES;

export interface ReceivePaymentInput {
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
  /** Constrain which obligations are eligible for allocation to only these IDs (planner chronology
   *  validation is skipped in this mode — the fetched set IS the allowed set). Used by gateway
   *  finalization where the set was already locked in at intent-creation time. */
  obligationIdFilter?: string[];
  /** Pass through to the planner as its 4th argument for chronology validation + selection
   *  filtering against the FULL outstanding set. Mutually exclusive in practice with
   *  obligationIdFilter — do not set both. */
  allowedObligationIds?: string[];
}

export interface ReceivePaymentResult {
  allocations: SettlementResult["allocations"];
  totalDue: number;
  totalPaid: number;
  remaining: number;
  futureCredit: number;
  overallStatus: string;
  groupId: string;
  settlementBreakdown: SettlementResult["settlementBreakdown"];
  plan: SettlementResult["plan"];
}

export interface ApplyAvailableCreditsInput {
  tenantId: string;
  hostelId: string;
  ownerId?: string;
  actorId?: string;
  /** Constrain to specific obligation(s) — used by the manual "apply credit to
   *  this obligation" admin action. Omit to sweep all outstanding obligations
   *  (the automatic activation sweep — see FinancialLifecycleService). */
  obligationIdFilter?: string[];
  /** Explicit amount to apply (manual case — must not exceed the available
   *  balance, validated below). Omit to auto-apply min(balance, outstanding)
   *  (automatic sweep case). */
  amountRupees?: number;
  /** Optional note stored on the resulting ledger debit entry. */
  notes?: string;
}

export interface ApplyAvailableCreditsResult extends ReceivePaymentResult {
  /** Available-credit balance remaining after this application. */
  remainingCreditBalance: number;
}

export interface PreviewSettlementInput {
  tenantId: string;
  hostelId: string;
  amountRupees: number;
  /** WHERE id IN (...) pre-filter on the obligation fetch. Omit to fetch all outstanding. */
  obligationIdFilter?: string[] | null;
  /** 4th argument to buildSettlementPlan — enables chronology validation + selection filtering
   *  against whatever set was fetched (the full set, unless obligationIdFilter narrowed it). */
  plannerAllowedObligationIds?: string[] | null;
}

export class FinancialPaymentFacade {
  /**
   * Plan-first settlement flow: load obligations → build plan via the
   * Settlement Planner → execute via the Settlement Engine. Must run inside
   * an existing Prisma transaction.
   */
  async receivePayment(
    tx: any,
    data: ReceivePaymentInput,
    groupId: string
  ): Promise<ReceivePaymentResult> {
    const obligations = await tx.rent_obligations.findMany({
      where: {
        tenant_id: data.tenantId,
        hostel_id: data.hostelId,
        status: { in: OUTSTANDING_STATUSES },
        is_superseded: false,
        ...(data.obligationIdFilter ? { id: { in: data.obligationIdFilter } } : {}),
      },
      include: {
        payments: { select: { amount_paid: true } },
      },
    });

    const snapshots = obligations.map((ob: any) => toObligationSnapshot(ob));

    const hostelRecord = await tx.hostels.findUnique({
      where: { id: data.hostelId },
      select: { preferences_config: true },
    });
    const paymentPolicy = financialPolicyEngine.resolvePaymentPolicy(hostelRecord);

    const plan = buildSettlementPlan(
      snapshots,
      data.amountPaid,
      paymentPolicy,
      data.allowedObligationIds
    );

    const result = await executePlanInTx(tx, plan, {
      hostelId: data.hostelId,
      tenantId: data.tenantId,
      amountPaid: data.amountPaid,
      paymentMethod: data.paymentMethod,
      referenceNumber: data.referenceNumber,
      paymentDate: data.paymentDate,
      paymentAttemptId: data.paymentAttemptId,
      idempotencyKey: data.idempotencyKey,
      userId: data.userId,
      ownerId: data.ownerId,
      offlineRecordedBy: data.offlineRecordedBy,
      offlineRecordedAt: data.offlineRecordedAt,
      offlineRecordedIp: data.offlineRecordedIp,
      offlineNote: data.offlineNote,
      source: data.paymentAttemptId ? "ONLINE" : "MANUAL",
      skipRejectionCheck: Boolean(data.paymentAttemptId),
    });

    return {
      allocations: result.allocations,
      totalDue: result.totalDue,
      totalPaid: result.totalPaid,
      remaining: result.remaining,
      futureCredit: result.futureCredit,
      overallStatus: result.overallStatus,
      groupId: result.paymentGroupId,
      settlementBreakdown: result.settlementBreakdown,
      plan: result.plan,
    };
  }

  /**
   * Apply existing future-rent-credit ledger balance against outstanding
   * obligations. Replaces the third, independent settlement path that used
   * to live in TenantFinancialLedgerService (own sort — rent_month only, no
   * SETTLEMENT_PRIORITY tiering; own allocation loop; single-column status
   * write with no lifecycle_status/settlement_status dual-write). Runs the
   * same Planner → Plan → Engine flow as receivePayment, just funded from
   * the ledger instead of new money — see executePlanInTx's
   * fundingSource: "EXISTING_CREDIT" branch for the ledger-side difference
   * (debit the applied amount instead of crediting overflow).
   *
   * Two calling shapes:
   *   - Automatic sweep (FinancialLifecycleService.activatePayableObligations):
   *     no amountRupees given — applies min(available balance, total
   *     outstanding) across ALL outstanding obligations, oldest-and-highest-
   *     priority first.
   *   - Manual (owner-initiated, one obligation): amountRupees + a single-ID
   *     obligationIdFilter — applies exactly that amount, validated against
   *     both the available balance and that obligation's outstanding amount.
   *
   * No-ops (returns null) when there is nothing to apply — matches the
   * original auto-sweep's silent no-op on a zero/negative balance.
   */
  async applyAvailableCredits(
    tx: any,
    input: ApplyAvailableCreditsInput
  ): Promise<ApplyAvailableCreditsResult | null> {
    // Lock the tenant row BEFORE reading the balance — otherwise a concurrent
    // application against the same tenant (e.g. two activation flows firing
    // close together) can read a stale balance here, build a plan against
    // it, and only discover the balance changed once it reaches
    // executePlanInTx's own (later) lock, surfacing as a spurious
    // "insufficient balance" error instead of a clean serialize-and-retry.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${input.tenantId}::uuid FOR UPDATE`;
    const balance = await this.resolveAvailableCredits(tx, input.tenantId);

    if (input.amountRupees !== undefined) {
      if (input.amountRupees > balance) {
        throw new Error(
          `BAD_REQUEST: Insufficient future rent credit balance. Available: ₹${balance.toFixed(2)}, Requested: ₹${input.amountRupees.toFixed(2)}`
        );
      }
    } else if (balance <= 0) {
      return null;
    }

    const obligations = await tx.rent_obligations.findMany({
      where: {
        tenant_id: input.tenantId,
        hostel_id: input.hostelId,
        status: { in: OUTSTANDING_STATUSES },
        is_superseded: false,
        ...(input.obligationIdFilter ? { id: { in: input.obligationIdFilter } } : {}),
      },
      include: { payments: { select: { amount_paid: true } } },
    });

    const snapshots = obligations.map((ob: any) => toObligationSnapshot(ob));
    const totalOutstanding = snapshots.reduce(
      (sum: number, s: any) => sum + Math.max(s.amount - s.paid, 0), 0
    );

    let effectiveAmount: number;
    if (input.amountRupees !== undefined) {
      if (input.amountRupees > totalOutstanding) {
        throw new Error(
          `BAD_REQUEST: Adjustment exceeds outstanding balance. Outstanding: ₹${totalOutstanding.toFixed(2)}, Requested: ₹${input.amountRupees.toFixed(2)}`
        );
      }
      effectiveAmount = input.amountRupees;
    } else {
      effectiveAmount = Math.min(balance, totalOutstanding);
    }

    if (effectiveAmount <= 0) return null;

    const hostelRecord = await tx.hostels.findUnique({
      where: { id: input.hostelId },
      select: { preferences_config: true },
    });
    const paymentPolicy = financialPolicyEngine.resolvePaymentPolicy(hostelRecord);

    const plan = buildSettlementPlan(snapshots, effectiveAmount, paymentPolicy);

    const result = await executePlanInTx(tx, plan, {
      hostelId: input.hostelId,
      tenantId: input.tenantId,
      amountPaid: effectiveAmount,
      paymentMethod: "ADVANCE_ADJUSTMENT",
      ownerId: input.ownerId,
      userId: input.actorId,
      offlineNote: input.notes,
      source: "CREDIT_APPLICATION",
      fundingSource: "EXISTING_CREDIT",
      skipRejectionCheck: true,
    });

    return {
      allocations: result.allocations,
      totalDue: result.totalDue,
      totalPaid: result.totalPaid,
      remaining: result.remaining,
      futureCredit: result.futureCredit,
      overallStatus: result.overallStatus,
      groupId: result.paymentGroupId,
      settlementBreakdown: result.settlementBreakdown,
      plan: result.plan,
      remainingCreditBalance: Math.round((balance - effectiveAmount) * 100) / 100,
    };
  }

  /**
   * Sole extension point for future credit sources. Today this does exactly
   * one thing: delegate to the future-rent-credit ledger balance. Not a
   * plugin/registry/strategy pattern — just a named seam for a second credit
   * source later, if one is ever needed.
   */
  private async resolveAvailableCredits(tx: any, tenantId: string): Promise<number> {
    return tenantFinancialLedgerService.getFutureRentCreditBalanceInTx(tx, tenantId);
  }

  /**
   * Read-only dry-run plan building — no writes, no locks. Consumed by
   * settlement-preview, settlement-plan, and create-intent's RENT-with-amount
   * validation step. Each caller explicitly controls obligation-fetch
   * filtering and planner-level selection independently, since the three
   * existing call sites have genuinely different (and load-bearing)
   * semantics here — this function does not collapse them into one implicit
   * mode.
   */
  async previewSettlement(params: PreviewSettlementInput): Promise<SettlementPlan> {
    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: params.tenantId,
        hostel_id: params.hostelId,
        status: { in: OUTSTANDING_STATUSES },
        is_superseded: false,
        ...(params.obligationIdFilter && params.obligationIdFilter.length > 0
          ? { id: { in: params.obligationIdFilter } }
          : {}),
      },
      include: { payments: { select: { amount_paid: true } } },
    });

    const snapshots = obligations.map((ob: any) => toObligationSnapshot(ob));

    const hostelRecord = await prisma.hostels.findUnique({
      where: { id: params.hostelId },
      select: { preferences_config: true },
    });
    const paymentPolicy = financialPolicyEngine.resolvePaymentPolicy(hostelRecord);

    return buildSettlementPlan(
      snapshots,
      params.amountRupees,
      paymentPolicy,
      params.plannerAllowedObligationIds || undefined
    );
  }
}

export const financialPaymentFacade = new FinancialPaymentFacade();
