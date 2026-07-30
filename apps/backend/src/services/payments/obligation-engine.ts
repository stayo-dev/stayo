import { getLogger } from "@/lib/logger";
import { randomUUID } from "crypto";
import { financialCorrectionGateway } from "./financial-correction-gateway";
import type { LifecycleStatus, SettlementStatus } from "./financial-obligation.types";
import { PAYABLE_STATUSES } from "./settlement-planner";

const logger = getLogger("obligation-engine");

/**
 * Canonical obligation types supported by the Financial Obligation Engine.
 * This is the exhaustive list — new types MUST be added here.
 */
export const OBLIGATION_TYPES = [
  "RENT",
  "SECURITY_DEPOSIT",
  "ADMISSION",
  "MAINTENANCE",
  "LATE_FEE",
  "FINE",
  "EXTRA_CHARGE",
  "DAMAGE",
  "UTILITY",
  "ADDITIONAL_CHARGE",
  "OTHER",
] as const;

export type ObligationType = (typeof OBLIGATION_TYPES)[number];

/** Statuses that allow payment, waiver, or cancellation */
const ACTIONABLE_STATUSES: readonly string[] = PAYABLE_STATUSES;

/**
 * 🏦 Obligation Engine — Financial Obligation Management
 *
 * Universal factory and lifecycle manager for all financial obligations.
 * All operations are IDEMPOTENT where applicable — safe to call multiple times
 * via the DB unique constraint (allocation_id, rent_month, obligation_type).
 *
 * Rule: Obligations are the SINGLE SOURCE OF TRUTH for money owed.
 * Frontend never calculates totals — it reads obligations.
 *
 * Lifecycle: DRAFT → PENDING → PARTIAL → PAID → WAIVED / CANCELLED
 *   - DRAFT: Created but not yet active (future: approval workflows)
 *   - PENDING: Active and awaiting payment
 *   - PARTIAL: Partially paid
 *   - PAID: Fully settled
 *   - WAIVED: Outstanding written off (generates ledger correction)
 *   - CANCELLED: Voided (generates ledger correction)
 */
export class ObligationEngine {
  /**
   * Create initial obligations when a tenant is invited.
   * Called INSIDE the invite transaction so everything is atomic.
   *
   * Creates:
   *   ADVANCE     → due on joining_date (if advance_deposit > 0)
   *   MAINTENANCE → due on joining_date (only if maintenance_type === "ONE_TIME" and charge > 0)
   *
   * Monthly maintenance is handled by the rent generation cron, not here.
   */
  async createInitialObligations(
    tx: any, // Prisma transaction client
    params: {
      tenantId: string;
      allocationId: string;
      ownerId: string;
      hostelId: string;
      joiningDate: Date;
      billingStartDate?: Date;
      monthlyRent?: number;
      createRent?: boolean;
      advanceDeposit: number;
      maintenanceCharge: number;
      maintenanceType: string; // "MONTHLY" | "ONE_TIME"
    }
  ) {
    const {
      tenantId,
      allocationId,
      ownerId,
      hostelId,
      joiningDate,
      billingStartDate,
      monthlyRent,
      createRent,
      advanceDeposit,
      maintenanceCharge,
      maintenanceType,
    } = params;

    const created: string[] = [];

    // rent_month anchor = 1st of joining month (deterministic UTC key)
    const rentMonth = new Date(
      Date.UTC(joiningDate.getFullYear(), joiningDate.getMonth(), 1)
    );

    // ── RENT obligation ─────────────────────────────────────────
    if (createRent && monthlyRent && monthlyRent > 0) {
      const wasCreated = await this.upsertObligation(tx, {
        tenantId,
        allocationId,
        ownerId,
        hostelId,
        rentMonth,
        amount: monthlyRent,
        dueDate: billingStartDate || joiningDate,
        obligationType: "RENT",
      });
      if (wasCreated) created.push("RENT");
    }

    // ── SECURITY_DEPOSIT obligation ─────────────────────────────
    if (advanceDeposit > 0) {
      const wasCreated = await this.upsertObligation(tx, {
        tenantId,
        allocationId,
        ownerId,
        hostelId,
        rentMonth,
        amount: advanceDeposit,
        dueDate: joiningDate,
        obligationType: "SECURITY_DEPOSIT",
      });
      if (wasCreated) created.push("SECURITY_DEPOSIT");
    }

    // ── ONE-TIME MAINTENANCE obligation ─────────────────────────
    if (maintenanceCharge > 0 && maintenanceType === "ONE_TIME") {
      const wasCreated = await this.upsertObligation(tx, {
        tenantId,
        allocationId,
        ownerId,
        hostelId,
        rentMonth,
        amount: maintenanceCharge,
        dueDate: joiningDate,
        obligationType: "MAINTENANCE",
      });
      if (wasCreated) created.push("MAINTENANCE");
    }

    logger.info(
      `Initial obligations for tenant ${tenantId}: [${created.join(", ") || "none"}]`
    );
    return created;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Universal Financial Obligation Factory
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create any type of financial obligation.
   * This is the universal entry point for manual obligation creation.
   *
   * Unlike createInitialObligations (which is called during invite),
   *   - Derives creation history via FinancialTimelineService (no obligation_events table)
   *   - Supports description and notes fields
   *   - Tracks the creator (created_by)
   *
   * Does NOT activate the obligation or sweep credit itself — callers must
   * follow up with FinancialLifecycleService.activatePayableObligations when
   * the created obligation's status is immediately payable (not DRAFT).
   *
   * Must be called INSIDE a transaction.
   */
  async createObligationInTx(
    tx: any,
    params: {
      tenantId: string;
      ownerId: string;
      hostelId: string;
      allocationId?: string | null;
      agreementId?: string | null;
      obligationType: string;
      amount: number;
      dueDate: Date;
      rentMonth: Date;
      description?: string | null;
      notes?: string | null;
      createdBy: string;
      billingPeriodStart?: Date | null;
      billingPeriodEnd?: Date | null;
      installmentLabel?: string | null;
      installmentSequence?: number | null;
      billingPlanId?: string | null;
      status?: string;
    }
  ): Promise<any> {
    const {
      tenantId,
      ownerId,
      hostelId,
      allocationId = null,
      agreementId = null,
      obligationType,
      amount,
      dueDate,
      rentMonth,
      description = null,
      notes = null,
      createdBy,
      billingPeriodStart = null,
      billingPeriodEnd = null,
      installmentLabel = null,
      installmentSequence = null,
      billingPlanId = null,
      status = "PENDING",
    } = params;

    if (amount <= 0) {
      throw new Error("BAD_REQUEST: Amount must be positive");
    }

    if (!OBLIGATION_TYPES.includes(obligationType as ObligationType)) {
      throw new Error(
        `BAD_REQUEST: Invalid obligation type '${obligationType}'. ` +
        `Allowed: ${OBLIGATION_TYPES.join(", ")}`
      );
    }

    const obligationId = randomUUID();

    const obligation = await tx.rent_obligations.create({
      data: {
        id: obligationId,
        tenant_id: tenantId,
        owner_id: ownerId,
        hostel_id: hostelId,
        allocation_id: allocationId,
        agreement_id: agreementId,
        obligation_type: obligationType,
        amount,
        total_amount: amount,
        due_date: dueDate,
        rent_month: rentMonth,
        status,
        // Dual-write: new columns
        lifecycle_status: status === "DRAFT" ? "ACTIVE" : "ACTIVE",
        settlement_status: "UNPAID",
        description,
        notes,
        created_by: createdBy,
        billing_period_start: billingPeriodStart,
        billing_period_end: billingPeriodEnd,
        installment_label: installmentLabel,
        installment_sequence: installmentSequence,
        billing_plan_id: billingPlanId,
      },
    });

    // No event table — obligation.created_at IS the event.
    // FinancialTimelineService derives creation events from this column.

    logger.info("obligation.created", {
      obligation_id: obligationId,
      tenant_id: tenantId,
      type: obligationType,
      amount,
      status,
    });

    return obligation;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cancel an obligation — voids it and generates a ledger correction.
   *
   * Rules:
   *   - Only obligations with no payments can be cancelled
   *   - Generates a CANCELLED event in the audit trail
   *   - Does NOT generate a ledger correction (no money was owed yet)
   *
   * Must be called INSIDE a transaction.
   */
  async cancelObligationInTx(
    tx: any,
    params: {
      obligationId: string;
      reason: string;
      actorId: string;
    }
  ): Promise<any> {
    const { obligationId, reason, actorId } = params;

    // Lock the obligation row
    const rows = await tx.$queryRaw<any[]>`
      SELECT * FROM rent_obligations WHERE id = ${obligationId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new Error("NOT_FOUND: Obligation not found");
    }
    const ob = rows[0];

    if (!ACTIONABLE_STATUSES.includes(ob.status)) {
      throw new Error(
        `BAD_REQUEST: Obligation cannot be cancelled in '${ob.status}' status`
      );
    }

    // Check for existing payments
    const payments = await tx.payments.findMany({
      where: { obligation_id: obligationId },
      select: { amount_paid: true },
    });
    const totalPaid = payments.reduce(
      (sum: number, p: any) => sum + Number(p.amount_paid),
      0
    );

    if (totalPaid > 0) {
      throw new Error(
        "BAD_REQUEST: Cannot cancel an obligation that has payments. Use waiver instead."
      );
    }

    const now = new Date();
    const updated = await tx.rent_obligations.update({
      where: { id: obligationId },
      data: {
        status: "CANCELLED",
        // Dual-write: new columns
        lifecycle_status: "CANCELLED" as LifecycleStatus,
        settlement_status: "UNPAID" as SettlementStatus,
        cancelled_at: now,
        cancelled_reason: reason,
        cancelled_by: actorId,
        updated_at: now,
      },
    });

    // Route through Financial Correction Gateway (no-op for cancellation today)
    await financialCorrectionGateway.applyCorrection(tx, {
      type: "CANCELLATION",
      obligationId,
      tenantId: ob.tenant_id,
      ownerId: ob.owner_id || actorId,
      actorId,
      amount: Number(ob.amount),
      reason,
      displayLabel: ob.obligation_type || "Obligation",
    });

    logger.info("obligation.cancelled", {
      obligation_id: obligationId,
      from_status: ob.status,
      amount: Number(ob.amount),
      reason,
      actor_id: actorId,
    });

    return updated;
  }

  /**
   * Waive an obligation — writes off the outstanding balance.
   *
   * Rules:
   *   - Only obligations with outstanding balance can be waived
   *   - Generates a WAIVED event in the audit trail
   *   - Creates a LEDGER_CORRECTION debit entry for the waived amount
   *   - Stores waiver metadata on the obligation row
   *
   * Must be called INSIDE a transaction.
   */
  async waiveObligationInTx(
    tx: any,
    params: {
      obligationId: string;
      reason: string;
      actorId: string;
    }
  ): Promise<{ obligation: any; waivedAmount: number }> {
    const { obligationId, reason, actorId } = params;

    // Lock the obligation row
    const rows = await tx.$queryRaw<any[]>`
      SELECT * FROM rent_obligations WHERE id = ${obligationId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new Error("NOT_FOUND: Obligation not found");
    }
    const ob = rows[0];

    if (ob.owner_id && ob.owner_id !== actorId) {
      throw new Error("FORBIDDEN: Access denied");
    }

    if (!ACTIONABLE_STATUSES.includes(ob.status)) {
      throw new Error(
        `BAD_REQUEST: Obligation cannot be waived in '${ob.status}' status`
      );
    }

    // Calculate outstanding
    const payments = await tx.payments.findMany({
      where: { obligation_id: obligationId },
      select: { amount_paid: true },
    });
    const totalPaid = payments.reduce(
      (sum: number, p: any) => sum + Number(p.amount_paid),
      0
    );
    const outstanding = Math.max(Number(ob.amount) - totalPaid, 0);

    if (outstanding <= 0) {
      throw new Error("BAD_REQUEST: Obligation is already fully settled");
    }

    const now = new Date();
    const updatedLifecycle: LifecycleStatus = "WAIVED";
    const updatedSettlement: SettlementStatus = totalPaid > 0 ? "PARTIAL" : "UNPAID";

    const updated = await tx.rent_obligations.update({
      where: { id: obligationId },
      data: {
        status: "WAIVED",
        // Dual-write: new columns
        lifecycle_status: updatedLifecycle,
        settlement_status: updatedSettlement,
        waived_at: now,
        waived_reason: reason,
        waived_by: actorId,
        waived_amount: outstanding,
        updated_at: now,
      },
    });

    // Route ledger correction through Financial Correction Gateway
    const monthLabel = ob.rent_month
      ? new Date(ob.rent_month).toLocaleDateString("en-IN", {
          month: "short",
          year: "numeric",
        })
      : "";
    const typeLabel = ob.obligation_type
      ? ob.obligation_type.replaceAll("_", " ")
      : "Rent";
    const displayType = monthLabel ? `${monthLabel} ${typeLabel}` : typeLabel;

    await financialCorrectionGateway.applyCorrection(tx, {
      type: "WAIVER",
      obligationId,
      tenantId: ob.tenant_id,
      ownerId: actorId,
      actorId,
      amount: outstanding,
      reason,
      displayLabel: displayType,
    });

    logger.info("obligation.waived", {
      obligation_id: obligationId,
      from_status: ob.status,
      waived_amount: outstanding,
      reason,
      actor_id: actorId,
    });

    return { obligation: updated, waivedAmount: outstanding };
  }

  /**
   * Waive a set of obligations in one pass — the only sanctioned batch entry
   * point, used by system-triggered sweeps (invitation cancellation, move-out
   * releases, stale-invitation expiry) that used to write
   * `rent_obligations.status = 'WAIVED'` directly, bypassing this engine
   * entirely (no ledger correction, no lifecycle/settlement dual-write).
   *
   * Skips (rather than aborts the batch for) any obligation that's already
   * terminal or fully settled — matching the pre-existing sweep semantics,
   * where a blanket `updateMany` silently skipped non-matching rows. Must be
   * called INSIDE a transaction.
   */
  async bulkWaiveInTx(
    tx: any,
    params: {
      obligationIds: string[];
      reason: string;
      actorId: string;
    }
  ): Promise<{ obligationId: string; waivedAmount: number }[]> {
    const { obligationIds, reason, actorId } = params;
    const results: { obligationId: string; waivedAmount: number }[] = [];

    for (const obligationId of obligationIds) {
      try {
        const { waivedAmount } = await this.waiveObligationInTx(tx, { obligationId, reason, actorId });
        results.push({ obligationId, waivedAmount });
      } catch (err: any) {
        const message = String(err?.message || err);
        // Not actionable (wrong status) or already fully settled — matches
        // the sweep semantics a blanket updateMany used to have (silently
        // skip non-matching rows) rather than aborting the whole batch.
        if (message.includes("NOT_FOUND") || message.includes("BAD_REQUEST")) {
          logger.info("obligation.bulk_waive_skip", { obligation_id: obligationId, reason: message });
          continue;
        }
        throw err;
      }
    }

    return results;
  }

  /**
   * Transition candidate obligations from UPCOMING → PENDING when their
   * billing month has started. Domain-only: does NOT know about credit,
   * ledgers, or settlement — see FinancialLifecycleService for the
   * orchestration that pairs this with a credit sweep.
   *
   * Idempotent: obligations not currently UPCOMING are returned as no-ops
   * with their current status, so this is safe to call redundantly (e.g. if
   * a caller passes an obligation ID that was already activated in a prior
   * run).
   *
   * Must be called INSIDE a transaction.
   */
  async markObligationsPayableInTx(
    tx: any,
    params: { obligationIds: string[] }
  ): Promise<{ id: string; previousStatus: string; newStatus: string }[]> {
    const { obligationIds } = params;
    if (obligationIds.length === 0) return [];

    // Lock candidate rows — same FOR UPDATE pattern as cancelObligationInTx /
    // waiveObligationInTx, extended to a batch via ANY($1::uuid[]).
    const rows: { id: string; status: string }[] = await tx.$queryRaw`
      SELECT id, status FROM rent_obligations WHERE id = ANY(${obligationIds}::uuid[]) FOR UPDATE
    `;

    const results: { id: string; previousStatus: string; newStatus: string }[] = [];
    const toActivate: string[] = [];

    for (const row of rows) {
      if (row.status === "UPCOMING") {
        toActivate.push(row.id);
      } else {
        // Idempotency guard: not UPCOMING — no-op, report current status.
        results.push({ id: row.id, previousStatus: row.status, newStatus: row.status });
      }
    }

    if (toActivate.length > 0) {
      const now = new Date();
      await tx.rent_obligations.updateMany({
        where: { id: { in: toActivate } },
        // Literal "PENDING" — never toLegacyStatus() here; this method has
        // no opinion about lifecycle/settlement dual-write columns beyond
        // the legacy status column (they're already ACTIVE/UNPAID for an
        // UPCOMING row and don't change here).
        data: { status: "PENDING", updated_at: now },
      });
      for (const id of toActivate) {
        results.push({ id, previousStatus: "UPCOMING", newStatus: "PENDING" });
      }
    }

    logger.info("obligation.marked_payable", {
      obligation_ids: obligationIds,
      activated_count: toActivate.length,
    });

    return results;
  }

  // Query operations are now handled by FinancialTimelineService.
  // No getObligationHistory method — timeline is derived, not stored.

  // ═══════════════════════════════════════════════════════════════════════════
  // Internal Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Idempotent obligation create.
   * Uses findFirst guard + P2002 fallback for race safety.
   */
  private async upsertObligation(
    tx: any,
    params: {
      tenantId: string;
      allocationId: string;
      ownerId: string;
      hostelId: string;
      rentMonth: Date;
      amount: number;
      dueDate: Date;
      obligationType: string;
    }
  ): Promise<boolean> {
    const {
      tenantId,
      allocationId,
      ownerId,
      hostelId,
      rentMonth,
      amount,
      dueDate,
      obligationType,
    } = params;

    try {
      const existing = await tx.rent_obligations.findFirst({
        where: {
          allocation_id: allocationId,
          rent_month: rentMonth,
          obligation_type: obligationType,
        },
      });
      if (existing) {
        logger.info(
          `${obligationType} obligation already exists for allocation ${allocationId}`
        );
        return false;
      }

      await tx.rent_obligations.create({
        data: {
          tenant_id: tenantId,
          allocation_id: allocationId,
          owner_id: ownerId,
          hostel_id: hostelId,
          rent_month: rentMonth,
          amount,
          total_amount: amount,
          due_date: dueDate,
          status: "PENDING",
          obligation_type: obligationType,
          created_by: ownerId,
        },
      });

      return true;
    } catch (err: any) {
      if (err?.code === "P2002") {
        // Concurrent insert — idempotent skip
        logger.info(
          `${obligationType} obligation race-skip for allocation ${allocationId}`
        );
        return false;
      }
      throw err;
    }
  }
}

export const obligationEngine = new ObligationEngine();
