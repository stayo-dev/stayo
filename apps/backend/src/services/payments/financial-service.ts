import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { billingRepository } from "@/src/repositories/billingRepository";
import { resolvePreferences } from "@/lib/preferences";
import { isOverdue } from "./settlement-planner";

/**
 * FinancialService — Canonical dues calculation layer
 *
 * DEFINITIONS:
 *
 *   OPERATIONAL DUES
 *     Obligations on ACTIVE tenants only.
 *     These are amounts the owner can realistically collect.
 *     Used by: dashboard summary cards, reminders, analytics collection rate.
 *     Excludes: LEFT, INVITED, EXPIRED, CANCELLED tenants.
 *
 *   HISTORICAL OUTSTANDING
 *     All PENDING/PARTIAL obligations regardless of tenant lifecycle status.
 *     Used by: accounting export, audit, overdue defaulter lists.
 *     Includes: every tenant who ever owed money and hasn't paid/waived it.
 *
 * FIELD CONSISTENCY:
 *   All calculations use `o.total_amount` (rent + late fees).
 *   Late fees are applied directly to the base RENT obligations by incrementing
 *   `late_fee` and `total_amount` fields.
 *
 * NO LOGIC DUPLICATION:
 *   Dashboard, analytics, tenant table, and reminders MUST call this service.
 *   Never write a raw obligation aggregate outside this file.
 */
export type PaymentStatus = "PAID" | "PARTIAL" | "PENDING" | "NOT_GENERATED" | "OVERDUE";

/**
 * Single source of truth for the tenant-level payment_status enum. Called
 * from both FinancialService.getTenantPaymentSummary() (sync, pre-fetched
 * obligation rows, used in batch/list views to avoid N+1 queries) and
 * FinancialReadModelService (async, single-tenant) — each caller derives
 * these four inputs from its own already-fetched data, but the branching
 * decision itself lives in exactly one place so the two paths can't drift.
 */
export function derivePaymentStatus(params: {
  hasObligations: boolean;
  pendingAmount: number;
  hasOverdue: boolean;
  hasAnyPayment: boolean;
}): PaymentStatus {
  if (!params.hasObligations) return "NOT_GENERATED";
  if (params.pendingAmount <= 0) return "PAID";
  if (params.hasOverdue) return "OVERDUE";
  if (params.hasAnyPayment) return "PARTIAL";
  return "PENDING";
}

export class FinancialService {
  async reconcileSettledOperationalObligations(ownerId: string, hostelId: string): Promise<number> {
    const rows = await prisma.$queryRaw<{ one: number }[]>`
      WITH pay_agg AS (
        SELECT obligation_id, SUM(amount_paid)::float AS total_paid
        FROM payments
        GROUP BY obligation_id
      ),
      to_fix AS (
        SELECT o.id
        FROM rent_obligations o
        LEFT JOIN pay_agg p ON p.obligation_id = o.id
        WHERE o.owner_id = ${ownerId}::uuid
          AND o.hostel_id = ${hostelId}::uuid
          AND o.status IN ('PENDING', 'PARTIAL', 'UPCOMING')
          AND o.total_amount - COALESCE(p.total_paid, 0) <= 0
      )
      UPDATE rent_obligations o
      SET status = 'PAID', updated_at = NOW()
      FROM to_fix f
      WHERE o.id = f.id
      RETURNING 1 AS one
    `;
    return rows.length;
  }

  /**
   * Operational cashflow metrics for a date range.
   *
   * Scope:
   * - ACTIVE tenants only
   * - obligations whose rent_month is within [start, end]
   * - excludes WAIVED obligations
   * - remaining balance is canonical: total_amount - paid
   */
  async getOperationalCashflowMetrics(
    ownerId: string,
    start: Date,
    end: Date,
    hostelId: string,
  ): Promise<{
    expected_total: number;
    collected_total: number;
    pending_total: number;
    overdue_total: number;
    unpaid_tenant_count: number;
    overdue_tenant_count: number;
    collection_rate: number;
  }> {
    await this.reconcileSettledOperationalObligations(ownerId, hostelId);

    const rows = await billingRepository.getOperationalCashflowMetrics(ownerId, start, end, hostelId);
    const row = rows[0];

    const expected = Number(row?.expected_total || 0);
    const collected = Number(row?.collected_total || 0);
    const pending = Number(row?.pending_total || 0);
    const rate = expected > 0
      ? Math.round(((collected / expected) * 100) * 100) / 100
      : 0;

    return {
      expected_total: expected,
      collected_total: collected,
      pending_total: pending,
      overdue_total: Number(row?.overdue_total || 0),
      unpaid_tenant_count: Number(row?.unpaid_tenant_count || 0),
      overdue_tenant_count: Number(row?.overdue_tenant_count || 0),
      collection_rate: rate,
    };
  }

  /**
   * Operational outstanding per tenant for a specific owner.
   * ACTIVE tenants only, remaining-balance basis.
   */
  async getOperationalOutstandingByTenants(
    ownerId: string,
    hostelId: string,
    tenantIds: string[],
  ): Promise<Map<string, number>> {
    const ids = Array.from(new Set(tenantIds.filter(Boolean)));
    if (ids.length === 0) return new Map();

    await this.reconcileSettledOperationalObligations(ownerId, hostelId);

    const rows = await billingRepository.getOperationalOutstandingByTenants(ownerId, hostelId, ids);

    return new Map(rows.map((r) => [r.tenant_id, Number(r.outstanding || 0)]));
  }

  /**
   * Operational dues for the dashboard:
   * - PENDING/PARTIAL obligations
   * - belonging to ACTIVE tenants only
   * - split into: pending (due_date >= today), overdue (due_date < today)
   */
  async getOperationalDues(ownerId: string, hostelId: string): Promise<{
    pending_total: number;
    overdue_total: number;
    overdue_count: number;
    unpaid_tenant_count: number;
    overdue_tenant_count: number;
  }> {
    await this.reconcileSettledOperationalObligations(ownerId, hostelId);

    const rows = await billingRepository.getOperationalDues(ownerId, hostelId);
    const row = rows[0];

    return {
      pending_total: row?.pending_total ?? 0,
      overdue_total: row?.overdue_total ?? 0,
      overdue_count: row?.overdue_count ?? 0,
      unpaid_tenant_count: row?.unpaid_tenant_count ?? 0,
      overdue_tenant_count: row?.overdue_tenant_count ?? 0,
    };
  }

  /**
   * Operational defaulters (ACTIVE tenants only), ranked by overdue outstanding.
   * Uses remaining amount (total_amount - paid), never raw amount.
   */
  async getOperationalDefaulters(
    ownerId: string,
    limit: number = 5,
    hostelId: string,
  ): Promise<Array<{
    tenant_id: string;
    name: string;
    pending_amount: number;
    days_overdue: number;
  }>> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit || 5)));
    const rows = await billingRepository.getOperationalDefaulters(ownerId, safeLimit, hostelId);

    return rows.map((r) => ({
      tenant_id: r.tenant_id,
      name: r.name,
      pending_amount: Number(r.pending_amount || 0),
      days_overdue: Number(r.days_overdue || 0),
    }));
  }

  /**
   * Overdue operational obligations for reminder engine.
   * ACTIVE tenants only; excludes cancelled/expired/invited/left lifecycle states.
   *
   * @param asOfDate  - Reference date for overdue calculation (default: now)
   * @param ownerId   - Optional: scope to a single owner. Omit for cron (all owners).
   */
  async getOperationalOverdueObligations(
    asOfDate: Date,
    ownerId: string,
    hostelId: string,
  ): Promise<Array<{
    obligation_id: string;
    tenant_id: string;
    owner_id: string;
    hostel_id: string | null;
    allocation_id: string | null;
    rent_month: Date;
    billing_period_start: Date | null;
    billing_period_end: Date | null;
    installment_label: string | null;
    installment_sequence: number | null;
    billing_plan_id: string | null;
    due_date: Date;
    amount: number;
    remaining_amount: number;
    tenant_name: string | null;
    personal_email: string | null;
    phone: string | null;
    late_fee: number;
    total_amount: number;
    access_mode: string | null;
  }>> {
    const rows = await billingRepository.getOperationalOverdueObligations(asOfDate, ownerId, hostelId);

    return rows.map((r) => ({
      obligation_id:    r.obligation_id,
      tenant_id:        r.tenant_id,
      owner_id:         r.owner_id,
      hostel_id:        r.hostel_id ?? null,
      allocation_id:    r.allocation_id,
      rent_month:       r.rent_month,
      billing_period_start: (r as any).billing_period_start ?? null,
      billing_period_end: (r as any).billing_period_end ?? null,
      installment_label: (r as any).installment_label ?? null,
      installment_sequence: (r as any).installment_sequence ?? null,
      billing_plan_id: (r as any).billing_plan_id ?? null,
      due_date:         r.due_date,
      amount:           Number(r.amount || 0),
      remaining_amount: Number(r.remaining_amount || 0),
      tenant_name:      r.tenant_name,
      personal_email:   r.personal_email,
      phone:            r.phone,
      late_fee:         Number((r as any).late_fee || 0),
      total_amount:     Number((r as any).total_amount || 0),
      access_mode:      (r as any).access_mode ?? null,
    }));
  }

  /**
   * Activated RENT obligations due today or within `maxBeforeDays` days and not
   * yet overdue. Feeds the before-due / due-day reminder pass. Same row shape as
   * getOperationalOverdueObligations.
   */
  async getOperationalUpcomingObligations(
    asOfDate: Date,
    ownerId: string,
    hostelId: string,
    maxBeforeDays: number,
  ): Promise<Awaited<ReturnType<FinancialService["getOperationalOverdueObligations"]>>> {
    const rows = await billingRepository.getOperationalUpcomingObligations(asOfDate, ownerId, hostelId, maxBeforeDays);

    return rows.map((r: any) => ({
      obligation_id:    r.obligation_id,
      tenant_id:        r.tenant_id,
      owner_id:         r.owner_id,
      hostel_id:        r.hostel_id ?? null,
      allocation_id:    r.allocation_id,
      rent_month:       r.rent_month,
      billing_period_start: (r as any).billing_period_start ?? null,
      billing_period_end: (r as any).billing_period_end ?? null,
      installment_label: (r as any).installment_label ?? null,
      installment_sequence: (r as any).installment_sequence ?? null,
      billing_plan_id: (r as any).billing_plan_id ?? null,
      due_date:         r.due_date,
      amount:           Number(r.amount || 0),
      remaining_amount: Number(r.remaining_amount || 0),
      tenant_name:      r.tenant_name,
      personal_email:   r.personal_email,
      phone:            r.phone,
      late_fee:         Number((r as any).late_fee || 0),
      total_amount:     Number((r as any).total_amount || 0),
      access_mode:      (r as any).access_mode ?? null,
    }));
  }


  /**
   * Historical outstanding — all tenants, no lifecycle filter.
   * Used for accounting reports and overdue defaulter lists.
   */
  async getHistoricalOutstanding(ownerId: string, hostelId: string): Promise<{
    outstanding_total: number;
    overdue_total: number;
    overdue_count: number;
  }> {
    const rows = await billingRepository.getHistoricalOutstanding(ownerId, hostelId);
    const row = rows[0];

    return {
      outstanding_total: row?.outstanding_total ?? 0,
      overdue_total:     row?.overdue_total     ?? 0,
      overdue_count:     row?.overdue_count     ?? 0,
    };
  }

  /**
   * Single-tenant dues breakdown.
   * Used by: payment page, tenant detail view, tenant list row.
   * Returns itemised list of PENDING/PARTIAL obligations with remaining amounts.
   * Does NOT include PAID obligations — they are settled.
   */
  async getTenantDues(tenantId: string, ownerId: string | undefined, hostelId: string): Promise<{
    tenant_id: string;
    items: TenantDueItem[];
    /** Everything unpaid, any due date — includes UPCOMING obligations. Kept
     *  as-is (not renamed) since receipt-service.ts depends on this meaning
     *  "all outstanding" for outstanding_balance_after on printed receipts. */
    total_due: number;
    /** Obligations already activated (status PENDING/PARTIAL, or legacy
     *  OVERDUE) — everything except UPCOMING — regardless of due date.
     *  current_payable_amount + upcoming_amount === total_due. */
    current_payable_amount: number;
    /** Subset of current_payable_amount that is also past due_date. */
    overdue_amount: number;
    /** Obligations still UPCOMING (not yet activated). */
    upcoming_amount: number;
    rent_due: number;
    security_deposit_due: number;
    maintenance_due: number;
    late_fees_due: number;
    obligation_count: number;
  }> {
    const obligations = await billingRepository.getTenantPendingObligations(tenantId, ownerId, hostelId);

    let totalLateFeesDue = 0;
    let rentDue = 0;
    let securityDepositDue = 0;
    let maintenanceDue = 0;

    const items: TenantDueItem[] = obligations.map((ob) => {
      const paid = ob.payments.reduce((s, p) => s + Number(p.amount_paid), 0);
      const outstanding = Math.max(Number(ob.total_amount || ob.amount) - paid, 0);
      const lateFeeVal = Number((ob as any).late_fee || 0);
      const itemLateFeeOutstanding = Math.min(lateFeeVal, outstanding);
      totalLateFeesDue += itemLateFeeOutstanding;

      const pureOutstanding = Math.max(0, outstanding - itemLateFeeOutstanding);
      if (ob.obligation_type === "RENT") {
        rentDue += pureOutstanding;
      } else if (ob.obligation_type === "SECURITY_DEPOSIT" || ob.obligation_type === "ADVANCE") {
        securityDepositDue += pureOutstanding;
      } else if (ob.obligation_type === "MAINTENANCE") {
        maintenanceDue += pureOutstanding;
      } else {
        rentDue += pureOutstanding;
      }

      return {
        obligation_id: ob.id,
        type: ob.obligation_type,
        rent_month: ob.rent_month,
        billing_period_start: (ob as any).billing_period_start,
        billing_period_end: (ob as any).billing_period_end,
        installment_label: (ob as any).installment_label,
        installment_sequence: (ob as any).installment_sequence,
        due_date: ob.due_date,
        amount: Number(ob.total_amount || ob.amount),
        paid,
        outstanding,
        late_fee: itemLateFeeOutstanding,
        status: ob.status,
        room_no: (ob as any).room_allocations?.room?.room_no ?? null,
      };
    }).filter((i) => i.outstanding > 0);

    const totalDue = items.reduce((s, i) => s + i.outstanding, 0);
    const today = new Date();
    const currentPayableAmount = items
      .filter((i) => i.status !== "UPCOMING")
      .reduce((s, i) => s + i.outstanding, 0);
    const upcomingAmount = items
      .filter((i) => i.status === "UPCOMING")
      .reduce((s, i) => s + i.outstanding, 0);
    const overdueAmount = items
      .filter((i) => i.status !== "UPCOMING" && isOverdue({ status: i.status, due_date: i.due_date }, today))
      .reduce((s, i) => s + i.outstanding, 0);

    return {
      tenant_id:        tenantId,
      items,
      total_due:        totalDue,
      current_payable_amount: currentPayableAmount,
      overdue_amount:   overdueAmount,
      upcoming_amount:  upcomingAmount,
      rent_due:         rentDue,
      security_deposit_due: securityDepositDue,
      maintenance_due:  maintenanceDue,
      late_fees_due:    totalLateFeesDue,
      obligation_count: items.length,
    };
  }

  /**
   * Compact payment summary for a tenant — used in list/table rows.
   * Reads PENDING/PARTIAL obligations only (no PAID, no WAIVED).
   */
  getTenantPaymentSummary(_tenantId: string, obligationRows: ObligationRow[]): {
    total_billed: number;
    total_paid: number;
    pending_amount: number;
    last_paid_at: Date | null;
    last_payment_amount: number;
    payment_status: "PAID" | "PARTIAL" | "PENDING" | "NOT_GENERATED" | "OVERDUE";
  } {
    let totalBilled = 0;
    let totalPaid   = 0;
    let lastPaidAt: Date | null = null;
    let lastPaymentAmount = 0;
    let hasOverdueObligation = false;

    const now = new Date();

    for (const ob of obligationRows) {
      if (ob.status === "WAIVED") continue;
      const totalAmt = Number(ob.total_amount || ob.amount);
      totalBilled += totalAmt;

      let obPaid = 0;
      for (const p of ob.payments) {
        const amt = Number(p.amount_paid);
        totalPaid += amt;
        obPaid += amt;
        const pd = new Date(p.payment_date);
        if (!lastPaidAt || pd > lastPaidAt) {
          lastPaidAt = pd;
          lastPaymentAmount = amt;
        }
      }

      const remaining = Math.max(0, totalAmt - obPaid);
      if (remaining > 0 && ob.status !== "PAID" && ob.due_date && isOverdue({ status: ob.status, due_date: new Date(ob.due_date) }, now)) {
        hasOverdueObligation = true;
      }
    }

    const pending = Math.max(0, totalBilled - totalPaid);
    const payment_status = derivePaymentStatus({
      hasObligations: totalBilled > 0,
      pendingAmount: pending,
      hasOverdue: hasOverdueObligation,
      hasAnyPayment: totalPaid > 0,
    });

    return {
      total_billed:         totalBilled,
      total_paid:           totalPaid,
      pending_amount:       pending,
      last_paid_at:         lastPaidAt,
      last_payment_amount:  lastPaymentAmount,
      payment_status,
    };
  }

  /**
   * Compute the financial status of a tenant.
   *
   * IMPORTANT — Field semantics:
   *
   *   `payable_now`
   *     Sum of outstanding balances on PENDING/PARTIAL obligations.
   *     This IS the actionable amount the tenant currently owes.
   *
   *   `projected_remaining_contract_value`
   *     For fixed-term tenants:  (monthly_rent × remaining_months) + deposit − total_paid − payable_now
   *     For open-ended tenants:  total_billed − total_paid − payable_now
   *
   *     ⚠️  This is a PROJECTION of future liability, NOT a payable amount.
   *     Do NOT display this as "amount due" on any UI surface.
   *     Use `payable_now` + ledger credit balance for the canonical "what tenant owes right now".
   *
   *   `fully_settled`
   *     True when payable_now === 0 AND projected_remaining_contract_value <= 0.
   */
  async getTenantFinancialStatus(tenantId: string): Promise<{
    payable_now: number;
    /** @deprecated Use a descriptive field name in new code. This is the projected remaining contract value, NOT current dues. */
    future_outstanding: number;
    projected_remaining_contract_value: number;
    next_generation_date: Date | null;
    next_due_date: Date | null;
    expected_amount: number | null;
    fully_settled: boolean;
  }> {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: {
        room_allocations: {
          orderBy: { start_date: "desc" },
        },
      },
    });
    if (!tenant) {
      throw new Error(`NOT_FOUND: Tenant with ID ${tenantId} not found`);
    }

    const agreement = await prisma.agreement.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ["SIGNED", "EXPIRING_SOON"] },
      },
      orderBy: { generated_at: "desc" },
    });

    const activeAllocation = tenant.room_allocations.find((a) => a.is_active) || tenant.room_allocations[0] || null;

    const monthly_rent = agreement
      ? Number(agreement.contract_rent ?? tenant.monthly_rent ?? 0)
      : Number(tenant.monthly_rent ?? 0);
    const security_deposit = agreement
      ? Number(agreement.contract_security_deposit ?? tenant.security_deposit ?? 0)
      : Number(tenant.security_deposit ?? 0);
    const maintenance_charge = Number(tenant.maintenance_charge ?? 0);
    const maintenance_type = tenant.maintenance_type || "NONE";

    const start_date = agreement?.agreement_start_date ?? activeAllocation?.start_date ?? tenant.billing_start_date ?? tenant.joined_on;
    const end_date = agreement?.agreement_end_date ?? activeAllocation?.end_date ?? null;

    const countMonths = (start: Date, end: Date): number => {
      const sY = start.getUTCFullYear();
      const sM = start.getUTCMonth();
      const eY = end.getUTCFullYear();
      const eM = end.getUTCMonth();
      return (eY - sY) * 12 + (eM - sM) + 1;
    };

    let duration_months = 0;
    if (agreement?.agreement_duration_months) {
      duration_months = agreement.agreement_duration_months;
    } else if (start_date && end_date) {
      duration_months = countMonths(new Date(start_date), new Date(end_date));
    }

    let total_contract_value = 0;
    const isFixedTerm = duration_months > 0;

    if (isFixedTerm) {
      total_contract_value = (monthly_rent * duration_months) + security_deposit;
      if (maintenance_type === "MONTHLY") {
        total_contract_value += maintenance_charge * duration_months;
      } else if (maintenance_type !== "NONE") {
        total_contract_value += maintenance_charge;
      }
    } else {
      const allBilled = await prisma.rent_obligations.findMany({
        where: {
          tenant_id: tenantId,
          is_superseded: false,
          status: { not: "WAIVED" },
        },
        select: {
          total_amount: true,
          amount: true,
        },
      });
      total_contract_value = allBilled.reduce((sum, ob) => sum + Number(ob.total_amount || ob.amount || 0), 0);
    }

    const payments = await prisma.payments.findMany({
      where: { tenant_id: tenantId },
      select: { amount_paid: true },
    });
    const total_paid = payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);

    // Delegates to getTenantDues() — the canonical "already-activated
    // obligation" definition — instead of re-fetching obligations and
    // re-summing them here.
    const dues = await this.getTenantDues(tenantId, tenant.owner_id ?? undefined, tenant.hostel_id);
    const payable_now = dues.current_payable_amount;

    const projected_remaining_contract_value = Math.max(0, total_contract_value - total_paid - payable_now);

    let next_generation_date: Date | null = null;
    let next_due_date: Date | null = null;
    let expected_amount: number | null = null;

    const earliestUnpaid = await prisma.rent_obligations.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ["PENDING", "PARTIAL"] },
        is_superseded: false,
      },
      orderBy: { due_date: "asc" },
      include: { payments: { select: { amount_paid: true } } },
    });

    if (earliestUnpaid) {
      const paid = earliestUnpaid.payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
      next_due_date = earliestUnpaid.due_date;
      expected_amount = Math.max(0, Number(earliestUnpaid.total_amount || earliestUnpaid.amount) - paid);
    }

    const nextUpcoming = await prisma.rent_obligations.findFirst({
      where: {
        tenant_id: tenantId,
        status: "UPCOMING",
        is_superseded: false,
      },
      orderBy: { due_date: "asc" },
    });

    if (nextUpcoming) {
      next_generation_date = nextUpcoming.rent_month;
      if (!next_due_date) {
        next_due_date = nextUpcoming.due_date;
        expected_amount = Number(nextUpcoming.total_amount || nextUpcoming.amount);
      }
    } else {
      const isContractActive = !end_date || new Date(end_date) > new Date();
      const isActiveTenant = !tenant.status.includes("LEFT") && tenant.status !== "CANCELLED" && tenant.status !== "EXPIRED";

      if (isContractActive && isActiveTenant) {
        const latestObligation = await prisma.rent_obligations.findFirst({
          where: {
            tenant_id: tenantId,
            obligation_type: "RENT",
            is_superseded: false,
            status: { not: "WAIVED" },
          },
          orderBy: { rent_month: "desc" },
        });

        const startRef = latestObligation?.rent_month
          ? new Date(latestObligation.rent_month)
          : (start_date ? new Date(start_date) : new Date());

        const nextMonthDate = latestObligation?.rent_month
          ? new Date(Date.UTC(startRef.getUTCFullYear(), startRef.getUTCMonth() + 1, 1))
          : new Date(Date.UTC(startRef.getUTCFullYear(), startRef.getUTCMonth(), 1));

        const hostel = await prisma.hostels.findUnique({
          where: { id: tenant.hostel_id },
          select: { preferences_config: true },
        });
        const prefs = resolvePreferences(hostel);
        const dueDay = Number(prefs.due_day || 5);
        const boundedDay = Math.max(1, Math.min(28, dueDay));
        const lastDay = new Date(Date.UTC(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, 0)).getUTCDate();

        next_generation_date = nextMonthDate;
        if (!next_due_date) {
          next_due_date = new Date(Date.UTC(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth(), Math.min(boundedDay, lastDay)));
          expected_amount = monthly_rent;
        }
      }
    }

    const fully_settled = payable_now === 0 && projected_remaining_contract_value <= 0;

    return {
      payable_now,
      future_outstanding: projected_remaining_contract_value, // backward compat alias
      projected_remaining_contract_value,
      next_generation_date,
      next_due_date,
      expected_amount,
      fully_settled,
    };
  }
}

export interface TenantDueItem {
  obligation_id: string;
  type: string;
  rent_month: Date;
  billing_period_start?: Date | null;
  billing_period_end?: Date | null;
  installment_label?: string | null;
  installment_sequence?: number | null;
  due_date: Date;
  amount: number;
  paid: number;
  outstanding: number;
  /** Portion of `outstanding` attributable to a late fee, per-item. */
  late_fee: number;
  status: string;
  room_no: string | null;
}

export interface ObligationRow {
  amount: number | string;
  total_amount?: number | string;
  status: string;
  due_date?: Date | string | null;
  payments: Array<{ amount_paid: number | string; payment_date: Date | string }>;
}

export const financialService = new FinancialService();
