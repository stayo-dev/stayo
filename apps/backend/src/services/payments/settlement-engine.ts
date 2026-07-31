/**
 * 🏗️ Settlement Engine — Pure Execution Module
 *
 * Executes a pre-built SettlementPlan. The Engine:
 *   1. Locks obligations (FOR UPDATE) in canonical priority order
 *   2. Validates hostel financial context
 *   3. Creates a PaymentGroup record
 *   4. Creates Payment records per allocation
 *   5. Updates obligation statuses atomically (dual-write: old + new columns)
 *   6. Returns a complete SettlementResult (no re-querying needed)
 *
 * Excess money has nowhere to go (ADR-036): StayO no longer holds future rent
 * credit, so a plan with `unallocated > 0` is refused outright. The payment
 * service generates the tenant's next installment(s) before planning.
 *
 * Properties:
 *   - Operates ONLY within a Prisma transaction (tx)
 *   - Receives a SettlementPlan — does NOT call the Planner
 *   - Does NOT know about policies — that's the Planner's job
 *   - Does NOT know about identity tokens, payment attempts, or webhooks
 *   - Consumed by: PaymentService, offline recording, finalization flows
 *
 * Architecture:
 *   Planner → SettlementPlan (data) → Engine → SettlementResult
 *   Engine never imports from settlement-planner.ts
 */

import { Prisma } from "@prisma/client";
import {
  assertFinancialHostelMatch,
  assertSameFinancialHostel,
  assertScopedEntityHostel,
  requireFinancialHostelId,
} from "@/lib/services/financial-isolation";
import { tenantFinancialLedgerService } from "./tenant-financial-ledger-service";
import { toLegacyStatus, type LifecycleStatus, type SettlementStatus } from "./financial-obligation.types";
import { getLogger } from "@/lib/logger";
import crypto from "crypto";

const logger = getLogger("settlement.engine");

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The plan to execute. Built externally by the Settlement Planner.
 * The engine trusts this plan and executes it as-is.
 */
export interface ExecutablePlan {
  allocations: Array<{
    obligation_id: string;
    type: string;
    tier: string;
    label: string;
    rent_month: Date | null;
    amount_due: number;
    outstanding: number;
    allocated: number;
    result: "PAID" | "PARTIAL" | "UNCHANGED";
  }>;
  unallocated: number;
  total_outstanding: number;
  total_to_settle: number;
  remaining_outstanding: number;
  payment_accepted: boolean;
  rejection_reason: string | null;
  summary: string;
  warnings: string[];
}

export interface ExecutionInput {
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
  /** Source of payment: MANUAL, ONLINE, CREDIT_APPLICATION */
  source?: string;
  /** If true, skip rejection check (used for gateway finalization) */
  skipRejectionCheck?: boolean;
}

export interface SettlementAllocationResult {
  payment_id: string;
  obligation_id: string;
  owner_id: string;
  obligation_type: string;
  rent_month: Date | null;
  installment_label: string;
  allocated: number;
  new_status: string;
  new_lifecycle_status: LifecycleStatus;
  new_settlement_status: SettlementStatus;
}

export interface SettlementBreakdown {
  allocations: {
    obligation_id: string;
    type: string;
    rent_month: Date | null;
    label: string;
    allocated: number;
    result: string;
  }[];
  total_settled: number;
  total_paid: number;
  total_due: number;
  remaining: number;
  summary: string;
}

export interface SettlementResult {
  /** Individual payment allocation results */
  allocations: SettlementAllocationResult[];
  /** Payment group that wraps all allocations */
  paymentGroupId: string;
  /** Financial totals */
  totalDue: number;
  totalPaid: number;
  remaining: number;
  overallStatus: string;
  /** Structured breakdown for receipts/audit */
  settlementBreakdown: SettlementBreakdown;
  /** The plan that was executed (for audit trail) */
  plan: ExecutablePlan;
  /** Ledger entries created during execution */
  ledgerEntries: string[];
  /** Obligation IDs that were updated */
  updatedObligationIds: string[];
}

// ── SQL priority clause (infrastructure concern for lock ordering) ────────────

const LOCK_PRIORITY: Record<string, number> = {
  SECURITY_DEPOSIT: 1,
  ADMISSION: 2,
  MAINTENANCE: 3,
  RENT: 4,
  LATE_FEE: 5,
  FINE: 5,
  EXTRA_CHARGE: 6,
  DAMAGE: 6,
  UTILITY: 6,
  ADDITIONAL_CHARGE: 6,
  OTHER: 7,
};

function buildSqlPriorityCaseClause(): string {
  const cases = Object.entries(LOCK_PRIORITY)
    .map(([type, priority]) => `WHEN obligation_type = '${type}' THEN ${priority}`)
    .join("\n        ");
  return `CASE ${cases} ELSE 99 END`;
}

// ── Engine ───────────────────────────────────────────────────────────────────

/**
 * Execute a pre-built settlement plan within an existing Prisma transaction.
 *
 * This is the canonical execution path for ALL payment settlement.
 * The Planner decides. The Engine executes.
 *
 * @param tx - Active Prisma transaction client
 * @param plan - Pre-built plan from the Settlement Planner
 * @param input - Execution parameters (who, how, metadata)
 * @returns SettlementResult with all created entities
 */
export async function executePlanInTx(
  tx: any,
  plan: ExecutablePlan,
  input: ExecutionInput
): Promise<SettlementResult> {
  const hostelId = requireFinancialHostelId(input.hostelId, "settlement engine");

  // ── 1. Validate plan acceptance ────────────────────────────────────────────
  if (!input.skipRejectionCheck && !plan.payment_accepted) {
    throw new Error(`BAD_REQUEST: ${plan.rejection_reason}`);
  }

  // ── 2. Lock tenant row ─────────────────────────────────────────────────────
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${input.tenantId}::uuid FOR UPDATE`;

  const tenant = await tx.tenants.findUnique({
    where: { id: input.tenantId },
    select: { id: true, monthly_rent: true, owner_id: true, hostel_id: true },
  });
  if (!tenant) throw new Error("NOT_FOUND: Tenant not found");

  if (tenant.hostel_id !== hostelId) {
    throw new Error("HOSTEL_CONTEXT_MISMATCH: Tenant does not belong to requested hostel");
  }
  if (input.ownerId && tenant.owner_id !== input.ownerId) {
    throw new Error("FORBIDDEN: Tenant does not belong to this owner");
  }

  // ── 3. Lock obligations (FOR UPDATE) in lock-priority order ────────────────
  const obligationIds = plan.allocations
    .filter(a => a.allocated > 0)
    .map(a => a.obligation_id);

  if (obligationIds.length === 0) {
    throw new Error("BAD_REQUEST: Plan has no allocations");
  }

  // ADR-036: excess has nowhere to go — no future-rent-credit balance exists.
  // The payment service must generate the tenant's next installment(s) before
  // planning, so anything left over here is a caller bug, not a balance.
  if (plan.unallocated > 0) {
    throw new Error(
      `BAD_REQUEST: Payment exceeds what can be settled — ₹${plan.unallocated} could not be allocated to any installment`,
    );
  }

  let obligations: any[] = [];
  if (obligationIds.length > 0) {
    const priorityClause = buildSqlPriorityCaseClause();
    const lockedRows: { id: string }[] = await tx.$queryRawUnsafe(`
      SELECT id FROM rent_obligations
      WHERE id = ANY($1::uuid[])
        AND hostel_id = $2::uuid
      ORDER BY
        ${priorityClause},
        due_date ASC,
        rent_month ASC
      FOR UPDATE
    `, obligationIds, hostelId);

    obligations = lockedRows.length > 0
      ? await tx.rent_obligations.findMany({
          where: { id: { in: lockedRows.map(r => r.id) } },
          include: {
            payments: { select: { amount_paid: true, hostel_id: true } },
            tenants: { select: { id: true, hostel_id: true, owner_id: true } },
            room_allocations: { select: { id: true, hostel_id: true } },
          },
        })
      : [];
  }

  // ── 4. Hostel financial isolation checks ───────────────────────────────────
  for (const ob of obligations) {
    assertScopedEntityHostel("rent obligation", ob, hostelId);
    assertSameFinancialHostel("tenant", (ob as any).tenants, "rent obligation", ob);
    if ((ob as any).room_allocations) {
      assertSameFinancialHostel("room allocation", (ob as any).room_allocations, "rent obligation", ob);
    }
    for (const payment of ob.payments) {
      assertSameFinancialHostel("existing payment", payment, "rent obligation", ob);
    }
  }

  // ── 5. Create Payment Group ────────────────────────────────────────────────
  const paymentGroupId = crypto.randomUUID();

  await tx.payment_groups.create({
    data: {
      id: paymentGroupId,
      tenant_id: input.tenantId,
      owner_id: input.ownerId || tenant.owner_id,
      hostel_id: hostelId,
      total_amount: input.amountPaid,
      method: input.paymentMethod,
      reference_number: input.referenceNumber || null,
      source: input.source || "MANUAL",
      status: "COMPLETED",
      recorded_by: input.userId || input.offlineRecordedBy || null,
      notes: input.offlineNote || null,
      future_credit_amount: 0, // ADR-036: retained column, never credited again
      // settlement_breakdown is set after execution
    },
  });

  // ── 6. Execute allocations — create Payments, update obligations ───────────
  const allocations: SettlementAllocationResult[] = [];
  const updatedObligationIds: string[] = [];

  for (const alloc of plan.allocations) {
    if (alloc.allocated <= 0) continue;
    const ob = obligations.find((o: any) => o.id === alloc.obligation_id);
    if (!ob) continue;

    const payment = await tx.payments.create({
      data: {
        obligation_id: ob.id,
        tenant_id: input.tenantId,
        owner_id: ob.owner_id,
        amount_paid: alloc.allocated,
        payment_method: input.paymentMethod,
        reference_number: input.referenceNumber,
        payment_date: input.paymentDate || new Date(),
        payment_attempt_id: input.paymentAttemptId || null,
        payment_group_id: paymentGroupId,
        idempotency_key: allocations.length === 0 ? (input.idempotencyKey || null) : null,
        offline_recorded_by: input.offlineRecordedBy || null,
        offline_recorded_at: input.offlineRecordedAt || null,
        offline_recorded_ip: input.offlineRecordedIp || null,
        offline_note: input.offlineNote || null,
        hostel_id: ob.hostel_id,
      },
    });
    assertFinancialHostelMatch("created payment", payment.hostel_id, ob.hostel_id);

    // Dual-write: update both old status AND new lifecycle/settlement columns
    const newSettlementStatus: SettlementStatus = alloc.result === "PAID" ? "PAID" : "PARTIAL";
    const newLifecycleStatus: LifecycleStatus = "ACTIVE"; // payments don't change lifecycle
    const legacyStatus = toLegacyStatus(newLifecycleStatus, newSettlementStatus, ob.due_date);

    await tx.rent_obligations.update({
      where: { id: ob.id },
      data: {
        status: legacyStatus,
        lifecycle_status: newLifecycleStatus,
        settlement_status: newSettlementStatus,
        updated_at: new Date(),
      },
    });

    // ADVANCE/SECURITY_DEPOSIT obligations also credit the ledger balance for
    // the amount just collected — the obligation being marked PAID/PARTIAL
    // tracks that the deposit/advance was billed, while this credit tracks
    // that it was collected. Ported from the retired single-obligation
    // _applyPaymentInTx so every settlement path behaves identically.
    if (ob.obligation_type === "ADVANCE" || ob.obligation_type === "SECURITY_DEPOSIT") {
      await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
        tenantId: ob.tenant_id,
        ownerId: ob.owner_id || "",
        createdBy: input.userId || input.offlineRecordedBy || ob.owner_id || "SYSTEM",
        amount: alloc.allocated,
        referenceId: payment.id,
        referenceType: "PAYMENT",
        reason: "DEPOSIT",
        notes: input.offlineNote || `Security deposit payment credited (Payment: ${payment.id})`,
      });
    }

    updatedObligationIds.push(ob.id);

    allocations.push({
      payment_id: payment.id,
      obligation_id: ob.id,
      owner_id: payment.owner_id,
      obligation_type: ob.obligation_type,
      rent_month: ob.rent_month,
      installment_label: alloc.label,
      allocated: alloc.allocated,
      new_status: legacyStatus,
      new_lifecycle_status: newLifecycleStatus,
      new_settlement_status: newSettlementStatus,
    });
  }

  // ── 7. No ledger side-effects ───────────────────────────────────────────────
  // ADR-036: future rent credit was removed. Every rupee lands on a real
  // installment (the payment service generates one if needed), so a settlement
  // never credits or debits `tenant_financial_ledger`. The guard above rejects
  // anything that could not be allocated.
  const ledgerEntries: string[] = [];

  // ── 8. Build settlement breakdown & store on payment group ─────────────────
  const totalPaid = Math.round(input.amountPaid * 100) / 100;
  const totalDue = plan.total_outstanding;
  const dueRemaining = plan.remaining_outstanding;
  const overallStatus = dueRemaining <= 0 ? "PAID" : "PARTIAL";

  const settlementBreakdown: SettlementBreakdown = {
    allocations: allocations.map(a => ({
      obligation_id: a.obligation_id,
      type: a.obligation_type,
      rent_month: a.rent_month,
      label: a.installment_label,
      allocated: a.allocated,
      result: a.new_status,
    })),
    total_settled: totalPaid,
    total_paid: totalPaid,
    total_due: totalDue,
    remaining: dueRemaining,
    summary: plan.summary,
  };

  // Update payment group with the immutable breakdown snapshot
  await tx.payment_groups.update({
    where: { id: paymentGroupId },
    data: {
      settlement_breakdown: settlementBreakdown as any,
      updated_at: new Date(),
    },
  });

  logger.info("settlement-engine.executed", {
    tenant_id: input.tenantId,
    hostel_id: hostelId,
    group_id: paymentGroupId,
    amount: totalPaid,
    allocations_count: allocations.length,
    overall_status: overallStatus,
  });

  return {
    allocations,
    paymentGroupId,
    totalDue,
    totalPaid,
    remaining: dueRemaining,
    overallStatus,
    settlementBreakdown,
    plan,
    ledgerEntries,
    updatedObligationIds,
  };
}
