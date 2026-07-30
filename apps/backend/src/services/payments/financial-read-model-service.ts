/**
 * 📊 Financial Read Model — Canonical Presentation Layer
 *
 * The single composed read model for "what does this tenant owe, why, and
 * what's the state of their account" — consumed by every owner and tenant
 * financial UI surface.
 *
 * This is a PRESENTATION model: it composes the existing canonical sources
 * (FinancialService.getTenantDues, TenantFinancialLedgerService.getBalance,
 * settlement-planner.isOverdue, financial-obligation.types.derivePresentationStatus)
 * and does not reimplement any of their logic. It does not expose internal
 * settlement-engine concepts (allocations, tiers, funding sources).
 *
 * See docs/business-logic/financial-consistency-investigation-report.md for
 * why this exists: prior to this service, ~6 independent calculators each
 * recomputed overlapping pieces of "outstanding/overdue/future-credit",
 * sometimes disagreeing (owner vs tenant screens showing different numbers
 * for the same tenant).
 */

import { prisma } from "@/lib/db";
import { financialService, derivePaymentStatus, type PaymentStatus } from "./financial-service";
import { tenantFinancialLedgerService } from "./tenant-financial-ledger-service";
import { isOverdue } from "./settlement-planner";

export interface FinancialReadModelItem {
  obligation_id: string;
  type: string;
  rent_month: Date;
  billing_period_start: Date | null;
  billing_period_end: Date | null;
  installment_label: string | null;
  installment_sequence: number | null;
  due_date: Date;
  /** total_amount (rent + late fee) */
  amount: number;
  paid: number;
  outstanding: number;
  /** Portion of `outstanding` attributable to a late fee. */
  late_fee: number;
  /** Raw rent_obligations.status, kept for callers still on the legacy single-column enum. */
  legacy_status: string;
  is_overdue: boolean;
  overdue_days: number;
  room_no: string | null;
}

export interface FinancialReadModel {
  tenant_id: string;
  generated_at: Date;

  items: FinancialReadModelItem[];

  // Pass-through from financialService.getTenantDues() — zero re-summing.
  total_due: number;
  current_payable_amount: number;
  overdue_amount: number;
  upcoming_amount: number;
  rent_due: number;
  security_deposit_due: number;
  maintenance_due: number;
  late_fees_due: number;
  obligation_count: number;

  /**
   * Same rent/security_deposit/maintenance/late_fees split as the fields
   * above, but scoped to currently-payable items only (excludes UPCOMING),
   * matching current_payable_amount's semantics. Use this for "what should
   * I pay right now" breakdown displays; use the fields above only where the
   * full-agreement "everything outstanding" semantic is actually wanted
   * (e.g. move-out settlement, settlement-preview snapshot).
   */
  current_payable_breakdown: {
    rent: number;
    security_deposit: number;
    maintenance: number;
    late_fees: number;
  };

  // Composed from `items`, not independently fetched.
  overdue_obligation_count: number;
  overdue_days: number;
  payment_status: PaymentStatus;

  // Pass-through from tenantFinancialLedgerService.getBalance()/getBalanceForTenant().
  future_rent_credit: number;
  ledger_balance: number;
  security_deposit: {
    /** Configured deposit amount for the tenant/agreement. */
    configured: number;
    /** Amount of that configured deposit actually paid, per the ledger. */
    paid: number;
    /** Outstanding security-deposit obligation amount (from obligations, not the ledger). */
    due: number;
  };
  last_ledger_update: Date | null;
}

type TenantDues = Awaited<ReturnType<typeof financialService.getTenantDues>>;
type LedgerBalance = Awaited<ReturnType<typeof tenantFinancialLedgerService.getBalance>>;

/**
 * UTC-midnight day-diff, mirroring settlement-planner.ts::isPastDueDate /
 * isLateFeeEligible's date math. Duplicated here (3 lines) rather than
 * exporting a new function from settlement-planner.ts, which is frozen per
 * project constraints — this is pure, unit-tested, display-only date math,
 * not business logic.
 */
function utcDaysOverdue(dueDate: Date, today: Date): number {
  const todayMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dueMid = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return Math.max(0, Math.ceil((todayMid - dueMid) / 86_400_000));
}

class FinancialReadModelService {
  /** Owner context — caller supplies ownerId/hostelId (already authorized). */
  async getFinancialReadModel(tenantId: string, ownerId: string | undefined, hostelId: string): Promise<FinancialReadModel> {
    const [dues, balance] = await Promise.all([
      financialService.getTenantDues(tenantId, ownerId, hostelId),
      tenantFinancialLedgerService.getBalance(tenantId, ownerId ?? await this._resolveOwnerId(tenantId)),
    ]);
    return this._build(dues, balance);
  }

  /** Tenant self-service context — resolves tenant/owner from the session's profileId. */
  async getFinancialReadModelForTenant(profileId: string): Promise<FinancialReadModel> {
    const tenant = await prisma.tenants.findUniqueOrThrow({
      where: { profile_id: profileId },
      select: { id: true, owner_id: true, hostel_id: true },
    });
    const [dues, balance] = await Promise.all([
      financialService.getTenantDues(tenant.id, tenant.owner_id ?? undefined, tenant.hostel_id),
      tenantFinancialLedgerService.getBalanceForTenant(profileId),
    ]);
    return this._build(dues, balance);
  }

  private async _resolveOwnerId(tenantId: string): Promise<string> {
    const tenant = await prisma.tenants.findUniqueOrThrow({
      where: { id: tenantId },
      select: { owner_id: true },
    });
    return tenant.owner_id;
  }

  private _build(dues: TenantDues, balance: LedgerBalance, today: Date = new Date()): FinancialReadModel {
    const items: FinancialReadModelItem[] = dues.items.map((i) => {
      const overdue = i.status !== "UPCOMING" && isOverdue({ status: i.status, due_date: i.due_date }, today);
      return {
        obligation_id: i.obligation_id,
        type: i.type,
        rent_month: i.rent_month,
        billing_period_start: i.billing_period_start ?? null,
        billing_period_end: i.billing_period_end ?? null,
        installment_label: i.installment_label ?? null,
        installment_sequence: i.installment_sequence ?? null,
        due_date: i.due_date,
        amount: i.amount,
        paid: i.paid,
        outstanding: i.outstanding,
        late_fee: i.late_fee,
        legacy_status: i.status,
        is_overdue: overdue,
        overdue_days: overdue ? utcDaysOverdue(i.due_date, today) : 0,
        room_no: i.room_no,
      };
    });

    const overdueItems = items.filter((i) => i.is_overdue);
    const overdue_days = overdueItems.length ? Math.max(...overdueItems.map((i) => i.overdue_days)) : 0;

    // Mirrors getTenantDues()'s type-classification (RENT / SECURITY_DEPOSIT|ADVANCE /
    // MAINTENANCE / else->rent) and its late-fee-vs-pure-amount split, but scoped to
    // currently-payable items only (excludes UPCOMING).
    const current_payable_breakdown = { rent: 0, security_deposit: 0, maintenance: 0, late_fees: 0 };
    for (const i of items) {
      if (i.legacy_status === "UPCOMING") continue;
      const pure = Math.max(0, i.outstanding - i.late_fee);
      current_payable_breakdown.late_fees += i.late_fee;
      if (i.type === "SECURITY_DEPOSIT" || i.type === "ADVANCE") current_payable_breakdown.security_deposit += pure;
      else if (i.type === "MAINTENANCE") current_payable_breakdown.maintenance += pure;
      else current_payable_breakdown.rent += pure;
    }

    const payment_status = derivePaymentStatus({
      hasObligations: dues.obligation_count > 0,
      pendingAmount: dues.total_due,
      hasOverdue: overdueItems.length > 0,
      hasAnyPayment: items.some((i) => i.paid > 0),
    });

    return {
      tenant_id: dues.tenant_id,
      generated_at: new Date(),
      items,
      total_due: dues.total_due,
      current_payable_amount: dues.current_payable_amount,
      overdue_amount: dues.overdue_amount,
      upcoming_amount: dues.upcoming_amount,
      rent_due: dues.rent_due,
      security_deposit_due: dues.security_deposit_due,
      maintenance_due: dues.maintenance_due,
      late_fees_due: dues.late_fees_due,
      obligation_count: dues.obligation_count,
      current_payable_breakdown,
      overdue_obligation_count: overdueItems.length,
      overdue_days,
      payment_status,
      future_rent_credit: balance.future_rent_credit,
      ledger_balance: balance.balance,
      security_deposit: {
        configured: balance.security_deposit,
        paid: balance.security_deposit_paid,
        due: dues.security_deposit_due,
      },
      last_ledger_update: balance.last_updated,
    };
  }
}

export const financialReadModelService = new FinancialReadModelService();
