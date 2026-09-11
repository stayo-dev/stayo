import { buildInviteSettlementPreview } from "@/lib/billing/invite-settlement-preview";
import type { TenantImportRow } from "./types";

/**
 * What one imported row's money would do, worked out before anything exists.
 *
 * Composes `buildInviteSettlementPreview` — the same pure planner behind the
 * single-tenant invite's settlement panel — rather than recalculating dues.
 * That is the rule this subsystem follows everywhere: compose, don't
 * reimplement, or the two surfaces drift and disagree about what a tenant owes.
 *
 * Without this, a row where the owner typed more than the tenant owes previews
 * as perfectly valid and then hard-fails inside `createInvitation` at confirm,
 * one row at a time, after other rows have already been created.
 */
export type RowFinancialPlan = {
  /** Everything the tenancy would owe from its joining date to today. */
  totalOwed: number;
  /** Money the planner could not place. Above zero means the owner overpaid. */
  unallocated: number;
};

export function planRowFinancials(
  row: TenantImportRow,
  options: { dueDay: number; today?: Date }
): RowFinancialPlan | null {
  const joiningDate = row.joining_date ? new Date(row.joining_date) : null;
  if (!joiningDate || Number.isNaN(joiningDate.getTime())) return null;

  const amountPaid = Number(row.amount_paid ?? 0);
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) return null;

  const preview = buildInviteSettlementPreview({
    monthlyRent: Number(row.monthly_rent ?? 0),
    securityDeposit: Number(row.security_deposit ?? row.advance_deposit ?? 0),
    maintenanceCharge: Number(row.maintenance_charge ?? 0),
    maintenanceType: String(row.maintenance_type ?? "MONTHLY"),
    agreementStartDate: joiningDate,
    durationMonths: Number(row.agreement_duration_months ?? 12),
    dueDay: options.dueDay,
    amountPaid,
    amountIncludesDeposit: row.amount_includes_deposit !== false,
    today: options.today ?? new Date(),
  });

  return {
    totalOwed: Number(preview.total_outstanding ?? 0),
    unallocated: Number(preview.unallocated ?? 0),
  };
}
