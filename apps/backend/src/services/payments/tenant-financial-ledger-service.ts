import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getLogger } from "@/lib/logger";

import { randomUUID } from "crypto";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

const logger = getLogger("tenant.financial-ledger");

// Refund lifecycle — physical money has not necessarily been returned until COMPLETED.
export type RefundStatus = "PENDING" | "COMPLETED" | "FAILED";

export class TenantFinancialLedgerService {
  /**
   * Get the current financial ledger balance and full ledger history for a tenant.
   * Balance = SUM(CREDIT) - SUM(DEBIT).
   * We recompute from ledger entries (authoritative), not from balance_after
   * snapshots (which are for audit display only).
   */
  async getBalance(tenantId: string, ownerId: string) {
    await this._assertOwnership(tenantId, ownerId);
    return this._buildBalanceResponse(tenantId);
  }

  /**
   * Tenant self-service balance — derives ownerId from DB, no caller-supplied ownerId.
   * Used by GET /api/tenants/me/advance.
   */
  async getBalanceForTenant(profileId: string) {
    const tenant = await prisma.tenants.findFirst({
      where: liveTenancyWhere(profileId),
      select: { id: true, owner_id: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    return this._buildBalanceResponse(tenant.id);
  }

  private async _buildBalanceResponse(tenantId: string) {
    const [entries, tenant, paidSecurityDepositObligations] = await Promise.all([
      prisma.tenant_financial_ledger.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: "asc" },
      }),
      prisma.tenants.findUniqueOrThrow({
        where: { id: tenantId },
        select: { security_deposit: true },
      }),
      prisma.payments.aggregate({
        where: {
          tenant_id: tenantId,
          obligation: {
            obligation_type: { in: ["SECURITY_DEPOSIT", "ADVANCE"] },
          },
        },
        _sum: {
          amount_paid: true,
        },
      }),
    ]);

    const balance = entries.reduce((acc: number, e: any) => {
      const amt = Number(e.amount);
      return e.type === "CREDIT" ? acc + amt : acc - amt;
    }, 0);

    const ledgerDepositPayments = entries.reduce((acc: number, entry: any) => {
      if (entry.type !== "CREDIT" || (entry.reason !== "DEPOSIT" && entry.reason !== "SECURITY_DEPOSIT_COLLECTED") || entry.reference_type !== "PAYMENT") return acc;
      return acc + Number(entry.amount || 0);
    }, 0);

    const configuredSecurityDeposit = Number(tenant.security_deposit || 0);
    const paidSecurityDepositObligationSum = Number(paidSecurityDepositObligations?._sum?.amount_paid || 0);
    const paidSecurityDepositObligationSumOutsideLedger = Math.max(0, paidSecurityDepositObligationSum - ledgerDepositPayments);
    const ledgerDepositCredits = this._sumLedgerCreditsByReason(entries, "SECURITY_DEPOSIT_COLLECTED");
    
    const ledgerSecurityDeposit = this._calculateLedgerSecurityDeposit({
      ledgerBalance: balance,
      configuredSecurityDeposit,
      paidSecurityDepositObligationSum: paidSecurityDepositObligationSumOutsideLedger,
      ledgerDepositCredits,
    });
    
    const futureRentCredit = Math.max(0, balance - ledgerSecurityDeposit);
    const paidSecurityDeposit = Math.min(configuredSecurityDeposit, ledgerSecurityDeposit + paidSecurityDepositObligationSumOutsideLedger);

    return {
      tenant_id: tenantId,
      balance: Math.round(balance * 100) / 100,
      last_updated: entries.length > 0 ? entries[entries.length - 1].created_at : null,
      entries,
      security_deposit: Math.round(configuredSecurityDeposit * 100) / 100,
      security_deposit_paid: Math.round(paidSecurityDeposit * 100) / 100,
      available_rent_advance: Math.round(futureRentCredit * 100) / 100, // Legacy key for backward compatibility
      future_rent_credit: Math.round(futureRentCredit * 100) / 100, // Standardized financial terminology
    };
  }

  /**
   * Record money received from tenant.
   * DEPOSIT is security deposit. TOPUP is future rent credit / rent advance.
   * Concurrency: SELECT FOR UPDATE on tenant row.
   */
  async credit(params: {
    tenantId: string;
    ownerId: string;
    createdBy: string;
    reason: "DEPOSIT" | "TOPUP" | "SECURITY_DEPOSIT_COLLECTED" | "FUTURE_RENT_CREDIT_TOPUP";
    amount: number;
    notes?: string;
    referenceId?: string;
    referenceType?: string;
  }) {
    const { tenantId, ownerId, createdBy, reason: inputReason, amount, notes, referenceId, referenceType } = params;
    const reason = mapLegacyReason(inputReason);

    if (amount <= 0) throw new Error("BAD_REQUEST: Amount must be positive");
    await this._assertOwnership(tenantId, ownerId);


    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const tenant = await tx.tenants.findUniqueOrThrow({
        where: { id: tenantId },
        select: { id: true, hostel_id: true },
      });
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const currentBalance = await this._computeBalance(tx, tenantId);
      const newBalance = Math.round((currentBalance + amount) * 100) / 100;
      const entry = await tx.tenant_financial_ledger.create({
        data: {
          id: randomUUID(),
          tenant_id: tenantId,
          owner_id: ownerId,
          hostel_id: tenant.hostel_id,
          type: "CREDIT",
          reason,
          amount,
          balance_after: newBalance,
          notes: notes || null,
          reference_id: referenceId || null,
          reference_type: referenceType || null,
          created_by: createdBy,
        },
      });
      
      logger.info("financial-ledger.credit", { tenant_id: tenantId, reason, amount, new_balance: newBalance, entry_id: entry.id });
      return { entry, balance: newBalance, hostelId: tenant.hostel_id };
    }).then(async (res) => {
      try {
        const { eventSystem } = await import("@/lib/events");
        await eventSystem.trigger("financial_ledger_credited", {
          tenant_id: tenantId,
          owner_id: ownerId,
          hostel_id: res.hostelId,
          amount,
          reason,
          entry_id: res.entry.id,
        });
      } catch (err) {
        logger.error("financial-ledger.credit.event_failed", { tenant_id: tenantId, err });
      }
      return { entry: res.entry, balance: res.balance };
    });
  }

  /**
   * Idempotent credit used exclusively by finalizePaymentAttempt().
   * Called INSIDE the caller's transaction — no new transaction started.
   * Guards against duplicate webhook processing via the DB unique index
   * on (reference_id, reference_type).
   *
   * Returns the existing entry if already credited (idempotent), or creates a new one.
   */
  async creditIdempotentInTx(
    tx: any,
    params: {
      tenantId: string;
      ownerId: string;
      createdBy: string;
      amount: number;
      referenceId: string;
      referenceType: string;
      notes?: string;
      reason?: "DEPOSIT" | "TOPUP" | "SECURITY_DEPOSIT_COLLECTED" | "FUTURE_RENT_CREDIT_TOPUP";
    }
  ) {
    const { tenantId, ownerId, createdBy, amount, referenceId, referenceType, notes, reason: inputReason = "FUTURE_RENT_CREDIT_TOPUP" } = params;
    const reason = mapLegacyReason(inputReason);

    // Idempotency: if a ledger entry already exists for this reference, return it.
    const existing = await tx.tenant_financial_ledger.findFirst({
      where: {
        reference_id: referenceId,
        reference_type: referenceType,
      },
      select: { id: true },
    });
    if (existing) {
      logger.info("financial-ledger.credit.already_credited", { reference_id: referenceId, reference_type: referenceType });
      return { alreadyCredited: true };
    }

    const tenant = await tx.tenants.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, hostel_id: true },
    });

    const currentBalance = await this._computeBalance(tx, tenantId);
    const newBalance = Math.round((currentBalance + amount) * 100) / 100;

    const entry = await tx.tenant_financial_ledger.create({
      data: {
        id: randomUUID(),
        tenant_id: tenantId,
        owner_id: ownerId,
        hostel_id: tenant.hostel_id,
        type: "CREDIT",
        reason,
        amount,
        balance_after: newBalance,
        notes: notes || `Gateway future rent payment credited`,
        reference_id: referenceId,
        reference_type: referenceType,
        created_by: createdBy,
      },
    });

    logger.info("financial-ledger.credit.from_gateway", {
      tenant_id: tenantId,
      reason,
      amount,
      new_balance: newBalance,
      entry_id: entry.id,
      reference_id: referenceId,
    });

    return { entry, balance: newBalance, alreadyCredited: false };
  }

  /**
   * Record ledger deduction or refund (DEDUCTION, REFUND, CORRECTION).
   * Validates balance is sufficient for DEDUCTION/REFUND.
   * Concurrency: SELECT FOR UPDATE on tenant row.
   */
  async debit(params: {
    tenantId: string;
    ownerId: string;
    createdBy: string;
    reason: "DEDUCTION" | "REFUND" | "CORRECTION" | "SECURITY_DEPOSIT_DEDUCTION" | "SECURITY_DEPOSIT_REFUNDED" | "LEDGER_CORRECTION" | "OBLIGATION_WAIVER" | "OBLIGATION_CANCELLATION";
    amount: number;
    notes?: string;
    referenceId?: string;
    referenceType?: string;
    refundStatus?: RefundStatus;
  }) {
    const { tenantId, ownerId, createdBy, reason: inputReason, amount, notes, referenceId, referenceType, refundStatus } = params;
    const reason = mapLegacyReason(inputReason);

    if (amount <= 0) throw new Error("BAD_REQUEST: Amount must be positive");
    await this._assertOwnership(tenantId, ownerId);


    // For REFUND: the entry is created with refund_status = PENDING.
    // Balance decreases immediately (intent recorded), but the physical money may not have
    // been returned yet. Owner must call the update-refund-status endpoint to mark COMPLETED.
    // CORRECTION entries bypass this — they are admin fixes and don't track physical flow.
    const effectiveRefundStatus =
      reason === "SECURITY_DEPOSIT_REFUNDED" ? (refundStatus ?? "PENDING") : null;

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const tenant = await tx.tenants.findUniqueOrThrow({
        where: { id: tenantId },
        select: { id: true, hostel_id: true },
      });
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const currentBalance = await this._computeBalance(tx, tenantId);

      if (reason !== "LEDGER_CORRECTION" && reason !== "OBLIGATION_WAIVER" && reason !== "OBLIGATION_CANCELLATION" && currentBalance < amount) {
        throw new Error(
          `BAD_REQUEST: Insufficient financial ledger balance. Available: ₹${currentBalance.toFixed(2)}, Requested: ₹${amount.toFixed(2)}`
        );
      }

      const newBalance = Math.max(0, Math.round((currentBalance - amount) * 100) / 100);

      const entry = await tx.tenant_financial_ledger.create({
        data: {
          id: randomUUID(),
          tenant_id: tenantId,
          owner_id: ownerId,
          hostel_id: tenant.hostel_id,
          type: "DEBIT",
          reason,
          amount,
          balance_after: newBalance,
          notes: notes || null,
          reference_id: referenceId || null,
          reference_type: referenceType || null,
          refund_status: effectiveRefundStatus,
          created_by: createdBy,
        },
      });

      logger.info("financial-ledger.debit", { tenant_id: tenantId, reason, amount, new_balance: newBalance, entry_id: entry.id, refund_status: effectiveRefundStatus });
      return { entry, balance: newBalance };
    });
  }

  /**
   * Record a debit entry on the financial ledger within an existing transaction.
   * Validates balance is sufficient for DEDUCTION/REFUND.
   * Concurrency: SELECT FOR UPDATE on tenant row.
   */
  async debitInTx(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      ownerId: string;
      createdBy: string;
      reason: "DEDUCTION" | "REFUND" | "CORRECTION" | "ADJUSTMENT" | "FUTURE_CREDIT_APPLIED" | "SECURITY_DEPOSIT_DEDUCTION" | "SECURITY_DEPOSIT_REFUNDED" | "LEDGER_CORRECTION" | "OBLIGATION_WAIVER" | "OBLIGATION_CANCELLATION";
      amount: number;
      notes?: string;
      referenceId?: string;
      referenceType?: string;
      refundStatus?: RefundStatus;
    }
  ) {
    const { tenantId, ownerId, createdBy, reason: inputReason, amount, notes, referenceId, referenceType, refundStatus } = params;
    const reason = mapLegacyReason(inputReason);

    if (amount <= 0) throw new Error("BAD_REQUEST: Amount must be positive");

    const effectiveRefundStatus =
      reason === "SECURITY_DEPOSIT_REFUNDED" ? (refundStatus ?? "PENDING") : null;

    // Ownership is checked on `tx`, not on the global client.
    //
    // This method runs inside a caller's interactive transaction, which holds
    // one pooled connection for its whole duration. Calling `_assertOwnership`
    // here issued a query on the *global* client — a second connection — while
    // that transaction was open. Under a saturated pool (Supabase's pooler)
    // that read waits for a free connection, blows past the interactive
    // transaction's 5s default timeout, and every subsequent `tx.*` call then
    // fails with "Transaction not found. Transaction ID is invalid, refers to
    // an old closed transaction" — which is how cancelling an invitation
    // surfaced as a 500 on `tenant_financial_ledger.create()`.
    //
    // Reading owner_id alongside hostel_id also removes a round trip: the
    // tenant row was being fetched twice.
    const tenant = await tx.tenants.findUnique({
      where: { id: tenantId },
      select: { id: true, hostel_id: true, owner_id: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: Tenant does not belong to this owner");
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
    const currentBalance = await this._computeBalance(tx, tenantId);

    if (reason !== "LEDGER_CORRECTION" && reason !== "OBLIGATION_WAIVER" && reason !== "OBLIGATION_CANCELLATION" && currentBalance < amount) {
      throw new Error(
        `BAD_REQUEST: Insufficient financial ledger balance. Available: ₹${currentBalance.toFixed(2)}, Requested: ₹${amount.toFixed(2)}`
      );
    }

    const newBalance = Math.max(0, Math.round((currentBalance - amount) * 100) / 100);

    const entry = await tx.tenant_financial_ledger.create({
      data: {
        id: randomUUID(),
        tenant_id: tenantId,
        owner_id: ownerId,
        hostel_id: tenant.hostel_id,
        type: "DEBIT",
        reason,
        amount,
        balance_after: newBalance,
        notes: notes || null,
        reference_id: referenceId || null,
        reference_type: referenceType || null,
        refund_status: effectiveRefundStatus,
        created_by: createdBy,
      },
    });

    logger.info("financial-ledger.debit-in-tx", { tenant_id: tenantId, reason, amount, new_balance: newBalance, entry_id: entry.id, refund_status: effectiveRefundStatus });
    return { entry, balance: newBalance };
  }

  /**
   * Update the physical refund status on an existing REFUND ledger entry.
   * This must be called when the bank transfer actually completes or fails.
   */
  async updateRefundStatus(entryId: string, ownerId: string, status: RefundStatus) {
    const entry = await prisma.tenant_financial_ledger.findUnique({
      where: { id: entryId },
      select: { owner_id: true, reason: true },
    });
    if (!entry) throw new Error("NOT_FOUND: Ledger entry not found");
    if (entry.owner_id !== ownerId) throw new Error("FORBIDDEN: Not your ledger entry");
    if (entry.reason !== "SECURITY_DEPOSIT_REFUNDED") throw new Error("BAD_REQUEST: Can only update refund_status on REFUND entries");

    return prisma.tenant_financial_ledger.update({
      where: { id: entryId },
      data: { refund_status: status },
    });
  }

  // adjustAgainstObligation / adjustAgainstObligationInTx and
  // autoApplyFutureRentCreditToDuesInTx / autoApplyAdvanceToDuesInTx retired —
  // superseded by FinancialPaymentFacade.applyAvailableCredits, which runs the
  // same Planner → Plan → Engine flow as every other settlement path
  // (SETTLEMENT_PRIORITY tiering, OVERDUE inclusion, lifecycle/settlement
  // dual-write) instead of this file's own independent allocation loop.

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _assertOwnership(tenantId: string, ownerId: string) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { owner_id: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: Tenant does not belong to this owner");
  }



  /**
   * Compute the current balance from all ledger entries.
   * CREDIT increases balance, DEBIT decreases it.
   * Always recompute — never trust a single balance_after snapshot.
   */
  private async _computeBalance(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const [credits, debits] = await Promise.all([
      tx.tenant_financial_ledger.aggregate({
        where: { tenant_id: tenantId, type: "CREDIT" },
        _sum: { amount: true },
      }),
      tx.tenant_financial_ledger.aggregate({
        where: { tenant_id: tenantId, type: "DEBIT" },
        _sum: { amount: true },
      }),
    ]);
    const creditSum = Number(credits._sum.amount ?? 0);
    const debitSum = Number(debits._sum.amount ?? 0);
    return Math.round((creditSum - debitSum) * 100) / 100;
  }

  private _sumLedgerCreditsByReason(entries: any[], reason: string): number {
    return entries.reduce((acc: number, entry: any) => {
      if (entry.type !== "CREDIT" || entry.reason !== reason) return acc;
      return acc + Number(entry.amount || 0);
    }, 0);
  }

  private _calculateLedgerSecurityDeposit(params: {
    ledgerBalance: number;
    configuredSecurityDeposit: number;
    paidSecurityDepositObligationSum: number;
    ledgerDepositCredits: number;
  }): number {
    const remainingSecurityDepositFromLedger = Math.max(
      0,
      params.configuredSecurityDeposit - params.paidSecurityDepositObligationSum
    );
    return this._roundCurrency(
      Math.min(
        Math.max(0, params.ledgerBalance),
        remainingSecurityDepositFromLedger,
        Math.max(0, params.ledgerDepositCredits)
      )
    );
  }

  /**
   * Public wrapper exposing the future-rent-credit balance computed by
   * _computeFinancialLedgerAvailabilityInTx, for callers (e.g.
   * FinancialPaymentFacade.applyAvailableCredits) that only need the balance,
   * not the full private availability breakdown.
   */
  async getFutureRentCreditBalanceInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const availability = await this._computeFinancialLedgerAvailabilityInTx(tx, tenantId);
    return availability.futureRentCredit;
  }

  private async _computeFinancialLedgerAvailabilityInTx(tx: Prisma.TransactionClient, tenantId: string) {
    const [tenant, paidSecurityDepositObligations, depositCredits, ledgerBalance, ledgerDepositPayments] = await Promise.all([
      tx.tenants.findUniqueOrThrow({
        where: { id: tenantId },
        select: { security_deposit: true },
      }),
      tx.payments.aggregate({
        where: {
          tenant_id: tenantId,
          obligation: {
            obligation_type: { in: ["SECURITY_DEPOSIT", "ADVANCE"] },
          },
        },
        _sum: {
          amount_paid: true,
        },
      }),
      tx.tenant_financial_ledger.aggregate({
        where: {
          tenant_id: tenantId,
          type: "CREDIT",
          reason: "SECURITY_DEPOSIT_COLLECTED",
        },
        _sum: {
          amount: true,
        },
      }),
      this._computeBalance(tx, tenantId),
      tx.tenant_financial_ledger.aggregate({
        where: {
          tenant_id: tenantId,
          type: "CREDIT",
          reason: "SECURITY_DEPOSIT_COLLECTED",
          reference_type: "PAYMENT",
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const paidSecurityDepositObligationSum = Number(paidSecurityDepositObligations?._sum?.amount_paid || 0);
    const ledgerDepositPaymentsSum = Number(ledgerDepositPayments?._sum?.amount || 0);
    const paidSecurityDepositObligationSumOutsideLedger = Math.max(0, paidSecurityDepositObligationSum - ledgerDepositPaymentsSum);

    const ledgerSecurityDeposit = this._calculateLedgerSecurityDeposit({
      ledgerBalance,
      configuredSecurityDeposit: Number(tenant.security_deposit || 0),
      paidSecurityDepositObligationSum: paidSecurityDepositObligationSumOutsideLedger,
      ledgerDepositCredits: Number(depositCredits?._sum?.amount || 0),
    });

    return {
      ledgerBalance,
      ledgerSecurityDeposit,
      futureRentCredit: this._roundCurrency(Math.max(0, ledgerBalance - ledgerSecurityDeposit)),
    };
  }

  private _roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

function mapLegacyReason(reason: string): any {
  switch (reason) {
    case "DEPOSIT":
      return "SECURITY_DEPOSIT_COLLECTED";
    case "TOPUP":
      return "FUTURE_RENT_CREDIT_TOPUP";
    case "ADJUSTMENT":
      return "FUTURE_RENT_CREDIT_ADJUSTMENT";
    case "FUTURE_CREDIT_APPLIED":
      return "FUTURE_CREDIT_APPLIED";
    case "DEDUCTION":
      return "SECURITY_DEPOSIT_DEDUCTION";
    case "REFUND":
      return "SECURITY_DEPOSIT_REFUNDED";
    case "CORRECTION":
      return "LEDGER_CORRECTION";
    case "OBLIGATION_WAIVER":
      return "OBLIGATION_WAIVER";
    case "OBLIGATION_CANCELLATION":
      return "OBLIGATION_CANCELLATION";
    default:
      return reason;
  }
}

export const tenantFinancialLedgerService = new TenantFinancialLedgerService();
